import path from "path"
import fs from "fs"

export function generateComponentList() {
    const testDir = path.join(
        process.cwd(),
        "src",
        "app",
        "tests",
        "[slug]",
        "components"
    )

    return fs.readdirSync(testDir).map((filename) => {
        const filePath = path.join(testDir, filename)
        const content = fs.readFileSync(filePath, "utf8")
        const titleMatch = content.match(
            /\/\*\*\s*\n\s*\*\s*Title:\s*(.*?)\s*\n/
        )
        const name = filename.replace(".tsx", "")
        return {
            name,
            title: titleMatch ? titleMatch[1] : name,
        }
    })
}
