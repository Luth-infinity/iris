/**
 * Le son de démarrage d'Iris, fabriqué de toutes pièces.
 *
 *   node son/generer.mjs            → les trois variantes dans son/
 *   node son/generer.mjs iris       → assets/son/demarrage.wav
 *
 * Il est synthétisé plutôt que pris ailleurs : un son de démarrage est une
 * signature, et un extrait trouvé sur internet appartient à quelqu'un. Tout
 * tient en quelques sinusoïdes — c'est ainsi que sonnent les cloches et les
 * carillons : une fondamentale et des partiels qui s'éteignent plus vite
 * qu'elle.
 */

import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ici = dirname(fileURLToPath(import.meta.url))
const TAUX = 44100

/** Une note, en hertz, à partir de son nom (A4 = 440 Hz). */
function hz(nom) {
  const gammes = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 }
  const [, lettre, diese, octave] = /^([A-G])(#?)(\d)$/.exec(nom)
  const demiTons = gammes[lettre] + (diese ? 1 : 0) + (Number(octave) - 4) * 12
  return 440 * 2 ** (demiTons / 12)
}

/**
 * Une cloche : la fondamentale, plus des partiels de plus en plus aigus et de
 * plus en plus courts. Le léger désaccord donne le battement qui fait « vrai »
 * plutôt que synthétique.
 */
function cloche(sortie, { note, debut, duree, gain = 0.25, partiels = [1, 2, 3, 4.2, 5.4] }) {
  const f = hz(note)
  const d0 = Math.floor(debut * TAUX)
  const n = Math.floor(duree * TAUX)
  // Une attaque nette mais pas raide : en dessous de dix millisecondes, on
  // entend un clic.
  const attaque = Math.floor(0.012 * TAUX)

  for (let i = 0; i < n; i++) {
    const t = i / TAUX
    let v = 0
    for (let p = 0; p < partiels.length; p++) {
      const rang = partiels[p]
      // Chaque partiel s'éteint plus vite que le précédent, et tous plus vite
      // que la fondamentale : c'est ce qui fait la couleur d'une cloche.
      const vie = duree / (1 + rang * 0.55)
      const desaccord = 1 + (p % 2 ? 0.0012 : -0.0009)
      v += (Math.sin(2 * Math.PI * f * rang * desaccord * t) * Math.exp(-t / vie)) / (1 + rang * 1.3)
    }
    const enveloppe = i < attaque ? i / attaque : 1
    const k = d0 + i
    if (k < sortie.length) sortie[k] += v * gain * enveloppe
  }
}

/** Un souffle : du bruit filtré qui gonfle et retombe, l'air avant la note. */
function souffle(sortie, { debut, duree, gain = 0.06 }) {
  const d0 = Math.floor(debut * TAUX)
  const n = Math.floor(duree * TAUX)
  let precedent = 0
  for (let i = 0; i < n; i++) {
    const t = i / TAUX
    // Passe-bas d'ordre un : le bruit blanc brut est agressif.
    const brut = Math.random() * 2 - 1
    precedent = precedent * 0.94 + brut * 0.06
    // Gonfle sur le premier tiers, retombe sur le reste.
    const forme = Math.sin(Math.PI * Math.min(1, t / duree)) ** 2
    const k = d0 + i
    if (k < sortie.length) sortie[k] += precedent * gain * forme
  }
}

/**
 * Une queue de réverbération, en quatre échos décalés. Sans elle, le son
 * s'arrête net et sonne comme un téléphone ; avec elle, il se pose.
 */
function reverberer(sortie, { melange = 0.3 } = {}) {
  const retards = [0.031, 0.047, 0.071, 0.097].map((s) => Math.floor(s * TAUX))
  const gains = [0.6, 0.48, 0.38, 0.3]
  const copie = Float64Array.from(sortie)
  for (let r = 0; r < retards.length; r++) {
    const retard = retards[r]
    for (let i = retard; i < sortie.length; i++) {
      sortie[i] += copie[i - retard] * gains[r] * melange
    }
  }
}

/** Normalise, puis écrit un WAV mono 16 bits. */
function ecrire(chemin, echantillons, { pic = 0.82 } = {}) {
  let max = 0
  for (const v of echantillons) max = Math.max(max, Math.abs(v))
  const facteur = max > 0 ? pic / max : 1

  const n = echantillons.length
  const donnees = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    let v = echantillons[i] * facteur
    // Fondu de sortie sur les dernières millisecondes : une coupure en plein
    // milieu d'une oscillation s'entend comme un claquement.
    const reste = n - i
    if (reste < 0.02 * TAUX) v *= reste / (0.02 * TAUX)
    donnees.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2)
  }

  const entete = Buffer.alloc(44)
  entete.write('RIFF', 0)
  entete.writeUInt32LE(36 + donnees.length, 4)
  entete.write('WAVE', 8)
  entete.write('fmt ', 12)
  entete.writeUInt32LE(16, 16)
  entete.writeUInt16LE(1, 20) // PCM
  entete.writeUInt16LE(1, 22) // mono
  entete.writeUInt32LE(TAUX, 24)
  entete.writeUInt32LE(TAUX * 2, 28)
  entete.writeUInt16LE(2, 32)
  entete.writeUInt16LE(16, 34)
  entete.write('data', 36)
  entete.writeUInt32LE(donnees.length, 40)

  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, Buffer.concat([entete, donnees]))
  return chemin
}

function tampon(secondes) {
  return new Float64Array(Math.floor(secondes * TAUX))
}

/** Trois notes qui montent et s'ouvrent, posées sur un souffle. */
function iris() {
  const s = tampon(2.6)
  souffle(s, { debut: 0, duree: 0.7, gain: 0.05 })
  cloche(s, { note: 'D4', debut: 0.06, duree: 2.2, gain: 0.22 })
  cloche(s, { note: 'A4', debut: 0.2, duree: 2.0, gain: 0.2 })
  cloche(s, { note: 'F#5', debut: 0.34, duree: 1.9, gain: 0.17 })
  // La quinte au-dessus, très en retrait : elle donne l'impression que le son
  // s'ouvre au lieu de simplement s'éteindre.
  cloche(s, { note: 'A5', debut: 0.52, duree: 1.6, gain: 0.09 })
  reverberer(s, { melange: 0.34 })
  return s
}

/** Deux notes tenues qui gonflent : plus calme, plus « respiration ». */
function souffleCourt() {
  const s = tampon(2.4)
  souffle(s, { debut: 0, duree: 1.4, gain: 0.09 })
  cloche(s, { note: 'D4', debut: 0.25, duree: 2.0, gain: 0.2, partiels: [1, 2, 3] })
  cloche(s, { note: 'A4', debut: 0.45, duree: 1.8, gain: 0.16, partiels: [1, 2, 3] })
  reverberer(s, { melange: 0.42 })
  return s
}

/** Quatre notes brèves, claires, vite finies : le plus discret des trois. */
function cristal() {
  const s = tampon(1.8)
  const notes = ['D5', 'F#5', 'A5', 'D6']
  notes.forEach((note, i) =>
    cloche(s, {
      note,
      debut: 0.05 + i * 0.075,
      duree: 1.2 - i * 0.12,
      gain: 0.2 - i * 0.02,
      partiels: [1, 2.8, 4.6]
    })
  )
  reverberer(s, { melange: 0.28 })
  return s
}

const variantes = { iris, souffle: souffleCourt, cristal }
const choisie = process.argv[2]

if (choisie) {
  const faire = variantes[choisie]
  if (!faire) throw new Error(`Variante inconnue : ${choisie}`)
  console.log(ecrire(join(ici, '..', 'assets', 'son', 'demarrage.wav'), faire()))
} else {
  for (const [nom, faire] of Object.entries(variantes)) {
    console.log(ecrire(join(ici, `demarrage-${nom}.wav`), faire()))
  }
}
