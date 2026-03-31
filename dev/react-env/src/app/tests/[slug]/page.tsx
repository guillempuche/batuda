import dynamic from "next/dynamic"
import { generateComponentList } from "./generate-list"
import styles from "./page.module.css"

export default async function Page({ params }: { params: { slug: string } }) {
    const { slug } = await params
    const DynamicComponent = dynamic(() =>
        import(`./components/${slug}`).then((mod) => mod.default)
    )

    return (
        <div className={styles.container}>
            <DynamicComponent />
        </div>
    )
}

export async function generateStaticParams() {
    return generateComponentList().map(({ name }) => ({ slug: name }))
}
