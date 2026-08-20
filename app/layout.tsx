import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Ecossistema de Inovação',
  description: 'Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
