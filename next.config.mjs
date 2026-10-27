/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Pacotes que só rodam no servidor e trazem binário nativo ou dependem de
  // módulos do Node. Sem isto, o empacotador tenta ler o .node do Argon2 como
  // se fosse JavaScript e o build falha. O PDFKit lê as fontes do próprio
  // diretório em tempo de execução, e o ExcelJS é grande: ficam fora do bundle.
  experimental: {
    serverComponentsExternalPackages: ['@node-rs/argon2', 'pg', 'pdfkit', 'exceljs', 'qrcode'],
  },
};

export default nextConfig;
