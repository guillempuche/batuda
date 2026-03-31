#!/usr/bin/env node

const fs = require("fs")
const path = require("path")

/**
 * Generate a slug from version number by replacing dots with dashes and removing leading zeros
 * e.g., "12.23.15" -> "plus-12-23-15" or "studio-sdk-12-23-15", "12.23.0" -> "plus-12-23" or "studio-sdk-12-23", "12.0.0" -> "plus-12" or "studio-sdk-12"
 */
function generateSlug(version, prefix = "plus") {
    // Remove brackets and split by dots
    const cleanVersion = version.replace(/[\[\]]/g, "")
    const parts = cleanVersion.split(".")

    // Remove leading zeros from each part and convert to numbers, then back to strings
    const cleanedParts = parts.map((part) => String(Number(part)))

    // Remove trailing zeros (but keep at least one part)
    while (
        cleanedParts.length > 1 &&
        cleanedParts[cleanedParts.length - 1] === "0"
    ) {
        cleanedParts.pop()
    }

    return prefix + "-" + cleanedParts.join("-")
}

/**
 * Parse version string to determine if it's major, minor, or patch
 * Based on semantic versioning (x.y.z)
 */
function getVersionType(version) {
    // Remove brackets and split by dots
    const cleanVersion = version.replace(/[\[\]]/g, "")
    const parts = cleanVersion.split(".")

    if (parts.length >= 3) {
        const [major, minor, patch] = parts.map(Number)

        // If this is the first version we're processing, we can't determine the type
        // For now, we'll use a simple heuristic based on the patch number
        if (patch > 0) return "patch"
        if (minor > 0) return "minor"
        return "major"
    }

    return "patch" // Default fallback
}

/**
 * Escape CSV field - handle quotes and commas
 */
function escapeCsvField(field) {
    if (field.includes('"') || field.includes(",") || field.includes("\n")) {
        return '"' + field.replace(/"/g, '""') + '"'
    }
    return field
}

/**
 * Parse a single changelog file and return entries
 */
function parseChangelogFile(changelogPath, slugPrefix, libraryName) {
    const content = fs.readFileSync(changelogPath, "utf8")
    const lines = content.split("\n")

    const entries = []
    let currentEntry = null
    let currentContent = []
    let inContentSection = false

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        // Check if this is a version header (## [version] date)
        const versionMatch = line.match(/^## \[([^\]]+)\] (.+)$/)
        if (versionMatch) {
            // Save previous entry if exists
            if (currentEntry) {
                currentEntry.content = currentContent.join("\n").trim()
                entries.push(currentEntry)
            }

            // Start new entry
            const version = versionMatch[1]
            const date = versionMatch[2]

            currentEntry = {
                version,
                date,
                content: "",
                type: getVersionType(version),
                slug: generateSlug(version, slugPrefix),
                library: libraryName,
            }
            currentContent = []
            inContentSection = false
            continue
        }

        // Skip the changelog header and intro
        if (!currentEntry) {
            continue
        }

        // Check if we're starting a content section (### Added, ### Fixed, etc.)
        if (line.match(/^### /)) {
            inContentSection = true
            currentContent.push(line)
            continue
        }

        // If we're in a content section, collect the content
        if (inContentSection) {
            currentContent.push(line)
        }
    }

    // Don't forget the last entry
    if (currentEntry) {
        currentEntry.content = currentContent.join("\n").trim()
        entries.push(currentEntry)
    }

    return entries
}

/**
 * Parse the changelogs and convert to CSV
 */
function parseChangelog() {
    const csvPath = path.join(__dirname, "..", "changelog.csv")

    try {
        const allEntries = []

        // Parse motion-plus changelog
        const motionPlusChangelogPath = path.join(
            __dirname,
            "..",
            "packages",
            "motion-plus",
            "CHANGELOG.md"
        )
        if (fs.existsSync(motionPlusChangelogPath)) {
            const motionPlusEntries = parseChangelogFile(
                motionPlusChangelogPath,
                "plus",
                "Motion+"
            )
            allEntries.push(...motionPlusEntries)
            console.log(
                `📦 Processed ${motionPlusEntries.length} entries from motion-plus`
            )
        } else {
            console.warn(
                `⚠️  Warning: motion-plus changelog not found at ${motionPlusChangelogPath}`
            )
        }

        // Sort entries by date (newest first) - assuming date format is YYYY-MM-DD
        allEntries.sort((a, b) => {
            return new Date(b.date) - new Date(a.date)
        })

        // Generate CSV
        const csvHeaders = "version,date,content,type,slug,library\n"
        const csvRows = allEntries
            .map((entry) => {
                return [
                    escapeCsvField(entry.version),
                    escapeCsvField(entry.date),
                    escapeCsvField(entry.content),
                    escapeCsvField(entry.type),
                    escapeCsvField(entry.slug),
                    escapeCsvField(entry.library),
                ].join(",")
            })
            .join("\n")

        const csvContent = csvHeaders + csvRows

        // Write CSV file
        fs.writeFileSync(csvPath, csvContent, "utf8")

        console.log(`✅ Successfully converted changelogs to CSV`)
        console.log(`📁 Output: ${csvPath}`)
        console.log(`📊 Total entries: ${allEntries.length}`)
    } catch (error) {
        console.error("❌ Error processing changelogs:", error.message)
        process.exit(1)
    }
}

// Run the script
if (require.main === module) {
    parseChangelog()
}

module.exports = { parseChangelog }
