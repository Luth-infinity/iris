const { join } = require('path')

module.exports = {
  plugins: {
    // Chemin explicite : Tailwind cherche sinon son fichier de configuration
    // dans le dossier d'où la commande est lancée, et retombe en silence sur
    // sa configuration par défaut — donc sans aucune de nos classes.
    tailwindcss: { config: join(__dirname, 'tailwind.config.js') },
    autoprefixer: {}
  }
}
