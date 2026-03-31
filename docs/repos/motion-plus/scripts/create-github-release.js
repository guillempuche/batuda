#!/usr/bin/env node

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

/**
 * Get version from motion-plus-dom package.json
 */
function getVersion() {
    const packageJsonPath = path.join(
        __dirname,
        "..",
        "packages",
        "motion-plus-dom",
        "package.json"
    )

    if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`Package.json not found at ${packageJsonPath}`)
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
    return packageJson.version
}

/**
 * Create GitHub release with UMD file
 */
function createGitHubRelease() {
    try {
        const version = getVersion()
        const tag = `v${version}`
        const umdFilePath = path.join(
            __dirname,
            "..",
            "packages",
            "motion-plus-dom",
            "dist",
            "motion-plus-dom.js"
        )

        // Check if UMD file exists
        if (!fs.existsSync(umdFilePath)) {
            throw new Error(`UMD file not found at ${umdFilePath}`)
        }

        // Skip pre-release versions
        if (version.includes("-")) {
            console.log(
                `⏭️  Skipping GitHub release for pre-release version: ${version}`
            )
            return
        }

        console.log(`📦 Creating GitHub release for version ${version}...`)

        // Check if release already exists
        try {
            execSync(`gh release view ${tag}`, { stdio: "pipe" })
            console.log(`⏭️  Release ${tag} already exists, skipping`)
            return
        } catch {
            // Release doesn't exist, continue
        }

        // Create the release with the UMD file
        const releaseCommand = `gh release create ${tag} "${umdFilePath}" --title "motion-plus-dom ${tag}" --notes "Release ${tag} of motion-plus-dom\n\nIncludes UMD build for vanilla JS usage."`

        execSync(releaseCommand, { stdio: "inherit" })

        console.log(`✅ Successfully created GitHub release ${tag}`)
    } catch (error) {
        console.error(`❌ Error creating GitHub release:`, error.message)
        process.exit(1)
    }
}

// Run the script
if (require.main === module) {
    createGitHubRelease()
}

module.exports = { createGitHubRelease }
