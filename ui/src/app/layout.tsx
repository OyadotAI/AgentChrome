import type { Metadata } from 'next';
import { DM_Sans, Archivo_Black } from 'next/font/google';
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

export const metadata: Metadata = {
  title: 'Oya Browser',
  description: 'Sign in once. Save a profile. Control your browsers from code.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning className={`${dmSans.variable} ${archivo.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('oya_theme')==='light'?'light':'dark'}catch{}` }} /></head>
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
