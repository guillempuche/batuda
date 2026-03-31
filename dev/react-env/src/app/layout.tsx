import type { Metadata } from "next"
import { JetBrains_Mono } from "next/font/google"
import "./globals.css"
import { Logo } from "./Logo"

const jetBrains = JetBrains_Mono({ weight: "400", subsets: ["latin"] })

export const metadata: Metadata = {
    title: "Motion playground",
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en">
            <head>
                <link
                    rel="icon"
                    href="https://framerusercontent.com/images/FEF0Xp0qllCZsG1uilpmdZAzD8.png"
                />
            </head>
            <body className={`${jetBrains.className}`}>
                <header>
                    <h1>
                        <a href="/" target="_blank">
                            <Logo />
                            <pre>{metadata.title as string}</pre>
                        </a>
                    </h1>
                </header>
                <main>{children}</main>
            </body>
        </html>
    )
}
