import './globals.css';

/** @type {import('next').Metadata} */
export const metadata = {
  title: 'Ecossistema de Inovação',
  description: 'Sistema de Gestão do Ecossistema de Inovação — Centro de Inovação',
};

/**
 * @param {{ children: React.ReactNode }} props
 */
export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
