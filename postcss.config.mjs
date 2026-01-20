/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // C'est ici que ça change pour la v4 :
    '@tailwindcss/postcss': {}, 
    autoprefixer: {},
  },
};

export default config;