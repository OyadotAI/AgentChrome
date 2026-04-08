import type { Metadata } from 'next';
import { DM_Sans, Archivo_Black, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
  weight: ['400', '500', '600', '700'],
});

const archivo = Archivo_Black({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-archivo',
  weight: '400',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: 'Oya Browser',
  description: 'The browser built for AI agents',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${archivo.variable} ${jetbrains.variable}`}>
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
