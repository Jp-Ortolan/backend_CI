/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Pacotes que só rodam no servidor e trazem binário nativo ou dependem de
  // módulos do Node. Sem isto, o empacotador tenta ler o .node do Argon2 como
  // se fosse JavaScript e o build falha.
  experimental: {
    serverComponentsExternalPackages: ['@node-rs/argon2', 'pg'],
  },
};

export default nextConfig;
