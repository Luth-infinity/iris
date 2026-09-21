/**
 * Fabrique les images à partir des SVG de ce dossier.
 *
 *   node logo/generer.mjs
 *
 * `sharp` n'est pas une dépendance d'Iris : il est emprunté à luth/node_modules
 * (comme pour le renard de Luth), une bibliothèque native de cette taille
 * n'ayant rien à faire dans une application qui ne redimensionne rien.
 */
import { createRequire } from 'module'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ici = dirname(fileURLToPath(import.meta.url))
const racine = join(ici, '..')
const assets = join(racine, 'assets')
mkdirSync(assets, { recursive: true })

const require = createRequire(join(racine, '..', 'luth', 'node_modules', 'sharp', 'index.js'))
const sharp = require('sharp')

/** La tuile complète : fond sombre, anneau violet, noyau clair. */
const tuile = join(ici, 'iris.svg')

/**
 * Glyphe de la zone de notification : une seule couleur, sans tuile. Sur le
 * fond de la barre des tâches, une tuile sombre se lit comme une case vide.
 */
const glyphe = (couleur) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <path d="M 16 4.5 A 11.5 11.5 0 1 0 27.5 16" fill="none" stroke="${couleur}"
        stroke-width="2.6" stroke-linecap="round" />
  <circle cx="16" cy="16" r="4.6" fill="${couleur}" />
</svg>`

const glyphes = {
  // Barre des tâches sombre : glyphe blanc. Barre claire : glyphe presque noir.
  'tray-dark': '#ffffff',
  'tray-light': '#26262b',
  // Iris travaille : son violet, seul moment où l'icône est colorée.
  'tray-actif': '#8b78ff'
}

for (const [nom, couleur] of Object.entries(glyphes)) {
  for (const taille of [16, 32]) {
    await sharp(Buffer.from(glyphe(couleur)))
      .resize(taille, taille)
      .png()
      .toFile(join(assets, `${nom}-${taille}.png`))
  }
}

// Icône d'application, et la même en PNG pour la vitrine.
const tailles = [16, 24, 32, 48, 64, 128, 256]
const pngs = await Promise.all(
  tailles.map((t) => sharp(tuile).resize(t, t).png().toBuffer())
)
writeFileSync(join(assets, 'icon.png'), pngs[pngs.length - 1])
await sharp(tuile).resize(1024, 1024).png().toFile(join(ici, 'iris-1024.png'))

/**
 * ICO écrit à la main : un `.ico` n'est qu'un répertoire suivi des images, et
 * Windows accepte des entrées PNG depuis Vista. Ajouter une dépendance pour
 * concaténer trois cents octets n'en valait pas la peine.
 */
const entete = Buffer.alloc(6)
entete.writeUInt16LE(0, 0) // réservé
entete.writeUInt16LE(1, 2) // type : icône
entete.writeUInt16LE(pngs.length, 4)

let offset = 6 + 16 * pngs.length
const entrees = pngs.map((png, i) => {
  const e = Buffer.alloc(16)
  // 0 signifie 256 : le champ ne fait qu'un octet.
  e.writeUInt8(tailles[i] >= 256 ? 0 : tailles[i], 0)
  e.writeUInt8(tailles[i] >= 256 ? 0 : tailles[i], 1)
  e.writeUInt8(0, 2) // palette
  e.writeUInt8(0, 3) // réservé
  e.writeUInt16LE(1, 4) // plans
  e.writeUInt16LE(32, 6) // bits par pixel
  e.writeUInt32LE(png.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += png.length
  return e
})

writeFileSync(join(assets, 'icon.ico'), Buffer.concat([entete, ...entrees, ...pngs]))

console.log('assets :', tailles.length, 'tailles dans icon.ico, glyphes 16 et 32 px générés')
