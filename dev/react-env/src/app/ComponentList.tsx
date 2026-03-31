"use client"

import * as motion from "motion/react-client"
import Link from "next/link"
import styles from "./page.module.css"

type Item = {
    name: string
    title: string
}

type ComponentListProps = {
    items: Item[]
}

function getComponentType(name: string): "react" | "js" {
    const reactComponents = ["AnimateNumber", "Cursor", "Ticker", "Typewriter"]
    return reactComponents.some((comp) => name.includes(comp)) ? "react" : "js"
}

function getComponentIcon(name: string): string {
    if (name.includes("AnimateNumber") || name.includes("Number")) return "№"
    if (name.includes("Cursor")) return "⌖"
    if (name.includes("Ticker")) return "⟲"
    if (name.includes("Typewriter")) return "⌨"
    if (name.includes("SplitText") || name.includes("splitText")) return "✂"
    return "◉"
}

function parseTitle(title: string): { name: string; description: string } {
    const parts = title.split(": ")
    if (parts.length >= 2) {
        return {
            name: parts[0],
            description: parts.slice(1).join(": "),
        }
    }
    return {
        name: title,
        description: "Motion component demo",
    }
}

export function ComponentList({ items }: ComponentListProps) {
    return (
        <div className={styles.container}>
            <motion.header
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
                className={styles.header}
            >
                <h1 className={styles.title}>Motion Components</h1>
                <p className={styles.subtitle}>
                    Explore premium Motion components and animations
                </p>
            </motion.header>

            <motion.ul
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 }}
                className={styles.list}
            >
                {items.map(({ name, title }, index) => {
                    const { name: componentName, description } =
                        parseTitle(title)
                    const type = getComponentType(name)
                    const icon = getComponentIcon(name)

                    return (
                        <motion.li
                            key={name}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                                duration: 0.4,
                                delay: 0.3 + index * 0.05,
                                ease: [0.4, 0, 0.2, 1],
                            }}
                            whileHover={{
                                y: -2,
                                transition: { duration: 0.2 },
                            }}
                            className={styles.listItem}
                        >
                            <Link
                                href={`/tests/${name}`}
                                className={styles.listLink}
                            >
                                <motion.div
                                    className={`${styles.componentIcon} ${styles[type]}`}
                                    whileHover={{
                                        scale: 1.1,
                                        transition: { duration: 0.2 },
                                    }}
                                >
                                    {icon}
                                </motion.div>
                                <div className={styles.componentContent}>
                                    <h3 className={styles.componentName}>
                                        {componentName}
                                    </h3>
                                    <p className={styles.componentDescription}>
                                        {description}
                                    </p>
                                </div>
                            </Link>
                        </motion.li>
                    )
                })}
            </motion.ul>
        </div>
    )
}
