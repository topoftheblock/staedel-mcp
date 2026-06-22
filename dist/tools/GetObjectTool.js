import z from 'zod';
export class GetObjectTool {
    apiClient;
    name = 'get-museum-object';
    description = 'Get detailed information about a specific Städel museum object by its OAI identifier (or bare ISIL ID). Returns metadata and optionally the CC BY-SA 4.0 high-res image.';
    inputSchema = z.object({
        objectId: z.string().describe('The OAI identifier (e.g., oai:sammlung.staedelmuseum.de:...) or bare ID'),
        returnImage: z.boolean().optional().default(true).describe('Whether to return the image (if available) as base64'),
    });
    constructor(apiClient) {
        this.apiClient = apiClient;
    }
    async execute({ objectId, returnImage }) {
        try {
            const rawRecord = await this.apiClient.getRecord(objectId);
            const metadata = rawRecord?.metadata?.['lido:lido'];
            if (!metadata)
                throw new Error('No LIDO metadata found for this record.');
            // 1. Flatten the LIDO data
            const parsedObject = this.flattenLidoRecord(rawRecord.header.identifier, metadata);
            // 2. Format the text for the LLM
            let text = `Object ID: ${parsedObject.objectId}\n`
                + `Title: ${parsedObject.primaryTitle}\n`
                + `Artist: ${parsedObject.artistDisplayName}\n`
                + `Date: ${parsedObject.objectDate}\n`
                + `License: ${parsedObject.license}\n`
                + (parsedObject.primaryImage ? `Image URL: ${parsedObject.primaryImage}\n` : '');
            // 3. Fetch Image if requested
            let imageContent = null;
            if (returnImage && parsedObject.primaryImage) {
                try {
                    const image = await this.apiClient.getImageAsBase64(parsedObject.primaryImage);
                    imageContent = { type: 'image', data: image.data, mimeType: image.mimeType };
                }
                catch {
                    text += '\nNote: Image could not be loaded or is restricted.';
                }
            }
            const content = [{ type: 'text', text }];
            if (imageContent)
                content.push(imageContent);
            return {
                content,
                structuredContent: { object: parsedObject },
            };
        }
        catch (error) {
            return { content: [{ type: 'text', text: `Error getting object ${objectId}: ${error}` }], isError: true };
        }
    }
    // --- LIDO Flattening Helpers ---
    flattenLidoRecord(oaiIdentifier, lido) {
        const descMeta = lido['lido:descriptiveMetadata'];
        const adminMeta = lido['lido:administrativeMetadata'];
        const titles = this.extractTitles(descMeta?.['lido:objectIdentificationWrap']?.['lido:titleWrap']);
        const constituents = this.extractActors(descMeta?.['lido:eventWrap']);
        const primaryImage = this.extractImage(adminMeta?.['lido:resourceWrap']);
        return {
            objectId: this.extractText(lido['lido:lidoRecID']) || oaiIdentifier,
            oaiIdentifier,
            titles,
            primaryTitle: titles['en'] || titles['de'] || 'Untitled',
            constituents,
            artistDisplayName: constituents.length > 0 ? constituents[0].name : 'Unknown Artist',
            objectDate: this.extractText(descMeta?.['lido:eventWrap']?.['lido:eventSet']?.[0]?.['lido:event']?.['lido:eventDate']?.['lido:displayDate']),
            primaryImage,
            objectURL: `https://sammlung.staedelmuseum.de/en/work/${oaiIdentifier.split(':').pop()}`,
            license: 'CC BY-SA 4.0 Städel Museum, Frankfurt am Main',
        };
    }
    extractTitles(titleWrap) {
        const titles = {};
        const titleSets = this.toArray(titleWrap?.['lido:titleSet']);
        for (const ts of titleSets) {
            const apps = this.toArray(ts['lido:appellationValue']);
            for (const app of apps) {
                const lang = app['@_xml:lang'] || 'unknown';
                titles[lang] = this.extractText(app);
            }
        }
        return titles;
    }
    extractActors(eventWrap) {
        const actors = [];
        const events = this.toArray(eventWrap?.['lido:eventSet']);
        for (const e of events) {
            const eventActors = this.toArray(e['lido:event']?.['lido:eventActor']);
            for (const ea of eventActors) {
                const actorInRole = ea['lido:actorInRole'];
                if (!actorInRole)
                    continue;
                const nameNode = actorInRole['lido:actor']?.['lido:nameActorSet']?.['lido:appellationValue'];
                const roleNode = actorInRole['lido:roleActor']?.['lido:term'];
                actors.push({
                    name: this.extractText(nameNode) || 'Unknown',
                    role: this.extractText(roleNode),
                    attribution: this.extractText(actorInRole['lido:attributionQualifierActor'])
                });
            }
        }
        return actors;
    }
    extractImage(resourceWrap) {
        const resources = this.toArray(resourceWrap?.['lido:resourceSet']);
        for (const r of resources) {
            const reps = this.toArray(r['lido:resourceRepresentation']);
            for (const rep of reps) {
                const link = this.extractText(rep['lido:linkResource']);
                if (link && (link.includes('.jpg') || link.includes('image')))
                    return link;
            }
        }
        return undefined;
    }
    // Safely extracts the text value from the fast-xml-parser node output
    extractText(node) {
        if (!node)
            return '';
        if (typeof node === 'string')
            return node;
        if (node['#text'])
            return String(node['#text']);
        if (Array.isArray(node))
            return this.extractText(node[0]);
        return '';
    }
    // Ensures we always iterate over an array, even if fast-xml-parser returned an object for a single node
    toArray(obj) {
        if (!obj)
            return [];
        return Array.isArray(obj) ? obj : [obj];
    }
}
