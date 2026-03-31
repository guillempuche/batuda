import Link from "next/link"
import styles from "./page.module.css"
import { generateComponentList } from "./tests/[slug]/generate-list"

export default async function Home() {
    return (
        <div className={styles.container}>
            <ul className={styles.list}>
                {generateComponentList().map(({ name, title }) => (
                    <li key={name}>
                        <Link href={`/tests/${name}`}>{title}</Link>
                    </li>
                ))}
            </ul>
        </div>
    )
}
