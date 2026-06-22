# Städel Museum MCP Server

A Model Context Protocol (MCP) server that provides AI models with direct access to the **Städel Museum Digital Collection**. This server interfaces with the museum's OAI-PMH API using the LIDO (Lightweight Information Describing Objects) format, allowing AI assistants to harvest records, retrieve rich multilingual metadata, and access high-resolution images.

## Features

This server provides AI models with the following tools to interact with the Städel Museum's collection:

### 1. List Sets (`list-sets`)
Lists all the valid organizational "Sets" (collections, departments, or categories) available in the Städel's OAI-PMH interface.
* **Inputs:** None
* **Output:** A list of Set Specs and Set Names (e.g., Paintings, Prints, Drawings).

### 2. Search Museum Objects (`search-museum-objects`)
Harvests object identifiers from the museum. Because this server uses an OAI-PMH interface, standard keyword searching is not supported. Instead, you filter the collection harvest by date or category.
* **Inputs:**
  * `set` (string, optional): An OAI-PMH Set spec to filter by.
  * `from` (string, optional): Datestamp (`YYYY-MM-DD`) to get records modified *after* this date.
  * `until` (string, optional): Datestamp (`YYYY-MM-DD`) to get records modified *before* this date.
  * `resumptionToken` (string, optional): Token for pagination.
* **Output:** A list of OAI identifiers and the total number of records in the current harvest batch.

### 3. Get Museum Object (`get-museum-object`)
Retrieves deep, structured LIDO metadata about a specific artwork using its OAI identifier, including its image (if available under Open Access).
* **Inputs:**
  * `objectId` (string): The OAI identifier of the object to retrieve.
  * `returnImage` (boolean, optional, default: true): Whether to fetch the image and return it as base64 data.
* **Output:** Multilingual titles, artist names, roles, attributions, dates, dimensions, medium, web links, and the base64-encoded CC BY-SA 4.0 image block.

### 4. Open Städel Explorer (`open-staedel-explorer`)
Launches an interactive MCP App (UI) inside supported clients, allowing users to visually browse and filter the harvested collection sets and datestamps.
* **Inputs:** `set` (optional), `from` (optional), `until` (optional).

---

## ⚖️ Licensing & Attribution (Important)

When using this MCP server, both users and AI agents must adhere to the Städel Museum's licensing rules:
* **Metadata:** The LIDO XML metadata provided by the Städel API is available under the **CC0 1.0** Public Domain Dedication.
* **Images:** High-resolution images are provided under a **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)** license.
* **Mandatory Credit Line:** Whenever an image from this server is displayed or referenced, it **must** be accompanied by the following credit line: 
  > **"Image: CC BY-SA 4.0 Städel Museum, Frankfurt am Main"**

---

## Prerequisites

* [Node.js](https://nodejs.org/) v18 or later
* [pnpm](https://pnpm.io/) (for building from source)

## Installation & Quick Start

If you are running the server from the source repository:

```bash
# 1. Enable corepack and install dependencies
corepack enable
pnpm install

# 2. Build the TypeScript files and UI bundles
pnpm run build

# 3. Start the server (Stdio transport)
node dist/index.js