import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'

export const metadata: Metadata = {
  title: 'The Coffee Society — history, ritual, and the life of a bean',
  description:
    'A slow reading room on the history of coffee, its social power, and its quiet influence on culture. Ask a question, we answer.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Nav />
        <main className="flex-1 relative z-10">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
