#!/usr/bin/env node

// Load environment variables from .env file
require("dotenv").config()

const fs = require("fs")
const path = require("path")
const Papa = require("papaparse")

async function pushToSite() {
    try {
        const projectId = process.env.FRAMER_PROJECT_ID
        if (!projectId) {
            throw new Error(
                "FRAMER_PROJECT_ID environment variable is required"
            )
        }

        // Parse changelog.csv
        const csvPath = path.join(__dirname, "..", "changelog.csv")
        if (!fs.existsSync(csvPath)) {
            throw new Error(`changelog.csv not found at ${csvPath}`)
        }

        const csvContent = fs.readFileSync(csvPath, "utf8")
        const { data: rows } = Papa.parse(csvContent, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (header) => header.trim(),
            transform: (value) => value.trim(),
        })

        console.log(`📄 Parsed ${rows.length} entries from changelog.csv`)

        // Dynamic import for ESM-only framer-api
        const { connect } = await import("framer-api")

        console.log(`🔗 Connecting to Framer...`)
        const framer = await connect(projectId)

        try {
            // Find the "Changelog" collection
            const collections = await framer.getCollections()
            const collection = collections.find(
                (c) => c.name === "Changelog"
            )

            if (!collection) {
                throw new Error(
                    'Collection "Changelog" not found. Please create it in Framer first.'
                )
            }

            console.log(`📦 Found "Changelog" collection`)

            // Map field names → field metadata
            const fields = await collection.getFields()
            const fieldNameToId = new Map(
                fields.map((f) => [f.name.toLowerCase(), f.id])
            )

            // For enum fields, build a case name → case ID map
            const enumCaseMaps = new Map()
            for (const field of fields) {
                if (field.type === "enum") {
                    const caseMap = new Map(
                        field.cases.map((c) => [c.name.toLowerCase(), c.id])
                    )
                    enumCaseMaps.set(field.id, caseMap)
                }
            }

            // Collect existing slugs
            const existingItems = await collection.getItems()
            const existingSlugs = new Set(
                existingItems.map((item) => item.slug)
            )

            console.log(
                `📋 ${existingItems.length} existing items in collection`
            )

            // Filter to only new entries
            const newRows = rows.filter((row) => !existingSlugs.has(row.slug))

            if (newRows.length === 0) {
                console.log(`✅ No new entries to add`)
            } else {
                // Build items
                const newItems = newRows.map((row) => {
                    const fieldData = {}

                    const versionFieldId = fieldNameToId.get("version")
                    if (versionFieldId) {
                        fieldData[versionFieldId] = {
                            type: "string",
                            value: row.version,
                        }
                    }

                    const dateFieldId = fieldNameToId.get("date")
                    if (dateFieldId) {
                        fieldData[dateFieldId] = {
                            type: "date",
                            value: row.date,
                        }
                    }

                    const contentFieldId = fieldNameToId.get("content")
                    if (contentFieldId) {
                        fieldData[contentFieldId] = {
                            type: "formattedText",
                            value: row.content,
                            contentType: "markdown",
                        }
                    }

                    const typeFieldId = fieldNameToId.get("type")
                    if (typeFieldId) {
                        const caseMap = enumCaseMaps.get(typeFieldId)
                        const caseId = caseMap?.get(row.type?.toLowerCase())
                        if (caseId) {
                            fieldData[typeFieldId] = {
                                type: "enum",
                                value: caseId,
                            }
                        }
                    }

                    const libraryFieldId = fieldNameToId.get("library")
                    if (libraryFieldId) {
                        const caseMap = enumCaseMaps.get(libraryFieldId)
                        if (caseMap) {
                            const caseId = caseMap.get(
                                row.library?.toLowerCase()
                            )
                            if (caseId) {
                                fieldData[libraryFieldId] = {
                                    type: "enum",
                                    value: caseId,
                                }
                            }
                        } else {
                            fieldData[libraryFieldId] = {
                                type: "string",
                                value: row.library,
                            }
                        }
                    }

                    return { slug: row.slug, fieldData }
                })

                await collection.addItems(newItems)
                console.log(`✅ Added ${newItems.length} new entries`)
            }

            // Publish the site
            console.log(`🚀 Publishing site...`)
            const result = await framer.publish()
            console.log(`✅ Site published`)

            if (result?.hostnames?.length > 0) {
                const primary = result.hostnames.find((h) => h.isPrimary)
                if (primary) {
                    console.log(`   URL: https://${primary.hostname}`)
                }
            }
        } finally {
            await framer.disconnect()
        }
    } catch (error) {
        console.error(`❌ Error pushing to site:`, error.message)
        if (error.code) console.error(`   Code: ${error.code}`)
        process.exit(1)
    }
}

// Run the script
if (require.main === module) {
    pushToSite()
}

module.exports = { pushToSite }
