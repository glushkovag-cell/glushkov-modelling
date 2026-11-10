# Glushkov Modelling MCP

MCP access to the Glushkov Modelling ship-model archive: build logs,
tutorials, photo galleries, content search, and rigging calculators.

The server connects compatible AI assistants to the published content
of Glushkov Modelling, helping users explore ship-modelling projects
and find relevant reference material.

## Use the service

Glushkov Modelling MCP is provided as a hosted service.

For an introduction, connection instructions, and supported clients, visit:

[Glushkov Modelling AI Hub](https://www.glushkov-modelling.com/ai-hub)

### Connection details

| Setting | Value |
| --- | --- |
| MCP endpoint | `https://mcp.glushkov-modelling.com/mcp-oauth` |
| Transport | Streamable HTTP |
| Authentication | OAuth 2.1 |
| Registry identifier | `com.glushkov-modelling/content` |

Use a client that supports remote MCP servers over Streamable HTTP
with OAuth authentication. Follow the connection guide for your client
on the AI Hub.

## What you can explore

- Ship-model projects and build logs.
- Tutorials and modelling techniques.
- Photo galleries documenting modelling projects.
- Relevant published content through search.
- Rope diameter calculations for scale modelling.
- Rigging diameter estimates for a whole model — standing and running
  rigging, bowsprit, anchor and gun ropes — using the same calculation
  core as the [rigging diameters tool](https://www.glushkov-modelling.com/tools/rigging-diameters).

## Example questions

Once connected, try asking your assistant:

- “What ship-model projects are documented in the archive?”
- “Find build logs related to hull construction.”
- “Find tutorials about rigging.”
- “Show me photographs from a modelling project.”
- “Help me calculate a rope diameter for my model’s scale.”
- “Estimate the rigging diameters for my 1:65 Santa Maria with an 8 mm mainmast.”

These are example requests, not tool names. The assistant determines
which available tools to use.

## Source code and hosting

This directory contains the source code for the Glushkov Modelling
hosted MCP service.

The source is published for transparency and reference. This repository
is not a self-hosting distribution: standalone installation, deployment
instructions, and support for independently hosted instances are not provided.

To use the server, connect to the hosted service rather than running
the source code locally.

## Repository structure

The MCP server is maintained in the `mcp-server` directory of the
Glushkov Modelling repository:

[Browse the MCP server source](https://github.com/glushkovag-cell/glushkov-modelling/tree/main/mcp-server)

## Questions and feedback

For service information and connection guidance, start with the
[AI Hub](https://www.glushkov-modelling.com/ai-hub).

When reporting a connection problem, include:

- The client name and version.
- The date and approximate time of the failure, including your time zone.
- The steps needed to reproduce the problem.
- The error message, with sensitive information removed.

Do not include access tokens, refresh tokens, client secrets,
or other credentials.
