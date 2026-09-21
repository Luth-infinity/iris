import { useCallback, useEffect, useRef, useState } from 'react'
import { Settings2, Square, X } from 'lucide-react'
import type { Etat, Forme, Tache } from '@shared/conversation'
import { FOURNISSEURS, type Reglages } from '@shared/reglages'
import { Anneau } from '@renderer/components/anneau'
import { Orbe } from '@renderer/components/orbe'
import { BilanTaches, BulleActivite, BulleTache, Bulles } from '@renderer/components/bulles'
import { FileLecture } from '@renderer/lib/lecture'
import {
  ErreurMicro,
  ouvrirAnalyseur,
  ouvrirMicro,
  prechaufferAudio,
  transcrire,
  type Souci
} from '@renderer/lib/micro'
import { lireDemande } from '@renderer/lib/commandes'
import { useSyncedTheme } from '@renderer/lib/theme'
import { cn } from '@renderer/lib/utils'
// Type seul : Vosk embarque son WASM, soit près de six mégaoctets qui ne
// doivent pas entrer dans le paquet commun aux trois fenêtres. Le module est
// chargé à la demande, si et seulement si le réveil au mot est coché.
import type { Veille } from '@renderer/lib/veille'

/**
 * Iris à l'écran.
 *
 * Deux formes, une seule fenêtre. En `barre`, elle apparaît devant soi : une
 * nappe de lumière, l'anneau qui suit la voix, et une phrase. En `pastille`,
 * elle se range au bord droit de l'écran pendant qu'elle travaille, réduite à
 * son orbe.
 *
 * Elle n'a jamais le focus (on l'invoque par-dessus un jeu), donc elle ne
 * reçoit aucune touche : le raccourci global valide, annule et interrompt.
 * Elle est aussi la seule fenêtre à avoir une sortie audio, donc c'est elle
 * qui joue la voix, même masquée.
 */

/**
 * Ce qu'Iris dit en ouvrant le micro. Tirée au sort à chaque fois : la même
 * phrase à chaque échange devient un décor qu'on ne lit plus.
 */
const ACCUEILS = ['Je t’écoute.', 'Oui ?', 'Qu’est-ce qu’il te faut ?', 'Vas-y.']

/**
 * La fin d'une demande se devine au silence.
 *
 * Sans ça, seul le raccourci refermait le micro : on appelait Iris à la voix,
 * puis il fallait revenir au clavier pour finir. Deux secondes de silence
 * après avoir parlé, c'est la pause d'une phrase finie, pas celle d'une
 * hésitation au milieu.
 */
const FIN_SILENCE = 2000
/** Personne ne parle après l'appel : on range le micro sans rien envoyer. */
const ATTENTE_MAX = 10000
/**
 * Après une réponse, le micro se rouvre pour enchaîner. L'attente est plus
 * courte : on n'a peut-être rien à ajouter, et la barre ne doit pas rester
 * dix secondes devant les yeux pour rien.
 */
const ATTENTE_SUITE = 6000
/** Garde-fou : une demande plus longue que ça est un micro resté ouvert. */
const DUREE_MAX = 90000
/** Durée de son continu qui fait dire « il parle » : un claquement ne suffit pas. */
const DEBUT_PAROLE = 200

export default function Overlay(): JSX.Element {
  useSyncedTheme()

  const [forme, setForme] = useState<Forme>('barre')
  const [sortie, setSortie] = useState(false)
  const [etat, setEtat] = useState<Etat>('repos')
  const [question, setQuestion] = useState('')
  const [reponse, setReponse] = useState('')
  /** L'action du moment, en français (« Écrit a.txt »). */
  const [outil, setOutil] = useState<string | null>(null)
  /** La liste de tâches de l'agent, telle que Claude Code la tient. */
  const [taches, setTaches] = useState<Tache[]>([])
  const [souci, setSouci] = useState<Souci | null>(null)
  const [accueil, setAccueil] = useState(ACCUEILS[0])
  /** L'écoute en cours enchaîne sur une réponse, sans nouvel appel. */
  const [enSuite, setEnSuite] = useState(false)
  /** Phrase du démarrage (« Dis « Iris »… »), effacée dès le premier échange. */
  const [annonce, setAnnonce] = useState<string | null>(null)
  const [secondes, setSecondes] = useState(0)
  const [niveau, setNiveau] = useState(0)
  /** Le spectre à suivre : le micro pendant qu'on parle, Iris quand elle répond. */
  const [analyseur, setAnalyseur] = useState<AnalyserNode | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const arretAnalyseRef = useRef<(() => void) | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const lectureRef = useRef<FileLecture | null>(null)
  const veilleRef = useRef<Veille | null>(null)
  /** Derniers réglages connus : la veille en a besoin hors du cycle de rendu. */
  const reglagesRef = useRef<Reglages | null>(null)
  /**
   * Chaque écoute porte un numéro. Une transcription qui revient après une
   * annulation appartient à un tour périmé : sans ce compteur, la question
   * partait alors qu'on venait de couper.
   */
  const ecouteRef = useRef(0)
  /** Minuterie qui surveille le silence pendant l'écoute. */
  const surveillanceRef = useRef<number | null>(null)

  // ─── Nettoyage ────────────────────────────────────────────────────────────

  const arreterTout = useCallback((): void => {
    if (surveillanceRef.current !== null) {
      clearInterval(surveillanceRef.current)
      surveillanceRef.current = null
    }
    arretAnalyseRef.current?.()
    arretAnalyseRef.current = null
    setAnalyseur(null)
    abortRef.current?.abort()
    abortRef.current = null
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const echouer = useCallback(
    (s: Souci): void => {
      ecouteRef.current++
      arreterTout()
      setSouci(s)
      window.api.ecouteErreur(s.titre)
    },
    [arreterTout]
  )

  // ─── Écoute ───────────────────────────────────────────────────────────────

  const demarrer = useCallback(
    async (reglages: Reglages, suite = false): Promise<void> => {
      const ecoute = ++ecouteRef.current
      setAnnonce(null)
      setSouci(null)
      setOutil(null)
      setSecondes(0)
      setEnSuite(suite)
      // En suite, sa réponse reste affichée : c'est souvent une question, et
      // on y répond en la lisant.
      if (!suite) {
        setQuestion('')
        setReponse('')
        setAccueil(ACCUEILS[Math.floor(Math.random() * ACCUEILS.length)])
      }
      lectureRef.current?.taire()

      if (!reglages.cleApi) {
        echouer({
          titre: 'Clé de transcription manquante',
          detail: `Ajoutez une clé ${FOURNISSEURS[reglages.fournisseur].label.split(' —')[0]} dans les paramètres.`,
          reglages: true
        })
        return
      }

      let stream: MediaStream
      try {
        stream = await ouvrirMicro(reglages, () =>
          window.api.noter('écoute : micro choisi introuvable, micro par défaut utilisé')
        )
      } catch (err) {
        if (err instanceof ErreurMicro) echouer(err.souci)
        else echouer({ titre: 'Micro indisponible', detail: String(err) })
        return
      }

      if (ecouteRef.current !== ecoute) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      streamRef.current = stream
      // L'anneau suit le micro pour de vrai : une animation libre s'agiterait
      // autant devant un micro muet, et c'est le seul signe qui prouve que le
      // bon périphérique est écouté.
      const analyse = ouvrirAnalyseur(stream)
      arretAnalyseRef.current = analyse.arreter
      setAnalyseur(analyse.analyseur)

      const morceaux: Blob[] = []
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) morceaux.push(e.data)
      }
      recorder.onstop = () => {
        if (surveillanceRef.current !== null) {
          clearInterval(surveillanceRef.current)
          surveillanceRef.current = null
        }
        arretAnalyseRef.current?.()
        arretAnalyseRef.current = null
        setAnalyseur(null)
        streamRef.current?.getTracks().forEach((t) => t.stop())
        if (ecouteRef.current !== ecoute) return

        const blob = new Blob(morceaux, { type: 'audio/webm' })
        // En dessous, il n'y a qu'un déclenchement involontaire : le service
        // facturerait une requête pour du silence.
        if (blob.size < 2000) {
          arreterTout()
          window.api.ecouteAnnulee()
          return
        }

        window.api.transcription()
        const controleur = new AbortController()
        abortRef.current = controleur
        void transcrire(blob, reglages, controleur.signal)
          .then((brut) => {
            if (ecouteRef.current !== ecoute) return
            const demande = lireDemande(brut)
            if (!demande) {
              arreterTout()
              window.api.ecouteAnnulee()
              return
            }
            setQuestion(demande)
            // Le main prend la suite : agent, puis voix.
            window.api.question(demande)
          })
          .catch((err) => {
            if (controleur.signal.aborted || ecouteRef.current !== ecoute) return
            if (err instanceof ErreurMicro) echouer(err.souci)
            else
              echouer({
                titre: 'Impossible de joindre le service',
                detail: String((err as Error)?.message || err).slice(0, 160)
              })
          })
      }
      recorder.start()

      // Surveillance du silence. Le seuil suit le bruit de fond de la pièce :
      // un seuil fixe se déclenchait sur un ventilateur, ou ratait une voix
      // posée devant un micro réglé bas.
      const echantillons = new Float32Array(analyse.analyseur.fftSize)
      const debut = performance.now()
      let bruit = 0.006
      let sonDepuis = 0
      let parle = false
      let dernierSon = debut
      surveillanceRef.current = window.setInterval(() => {
        if (ecouteRef.current !== ecoute || recorder.state !== 'recording') return
        analyse.analyseur.getFloatTimeDomainData(echantillons)
        let somme = 0
        for (const v of echantillons) somme += v * v
        const rms = Math.sqrt(somme / echantillons.length)
        const maintenant = performance.now()

        if (rms > Math.max(0.015, bruit * 3)) {
          sonDepuis ||= maintenant
          if (maintenant - sonDepuis >= DEBUT_PAROLE) parle = true
          dernierSon = maintenant
        } else {
          sonDepuis = 0
          bruit = bruit * 0.95 + rms * 0.05
        }

        if (parle && maintenant - dernierSon > FIN_SILENCE) {
          window.api.noter('silence : envoi')
          arreterRef.current()
        }
        else if (!parle && maintenant - debut > (suite ? ATTENTE_SUITE : ATTENTE_MAX)) {
          annulerRef.current()
        }
        else if (maintenant - debut > DUREE_MAX) arreterRef.current()
      }, 100)
    },
    [arreterTout, echouer]
  )

  const arreter = useCallback((): void => {
    // On ne touche pas au numéro d'écoute : `onstop` doit poursuivre jusqu'à
    // la transcription.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  /** Tout ranger sans rien envoyer : « laisse tomber », ou personne n'a parlé. */
  const annuler = useCallback((): void => {
    ecouteRef.current++
    arreterTout()
    window.api.ecouteAnnulee()
  }, [arreterTout])

  // La surveillance tourne dans une minuterie créée par `demarrer` : elle lit
  // ces fonctions par référence pour ne pas en garder une version périmée.
  const arreterRef = useRef(arreter)
  const annulerRef = useRef(annuler)
  arreterRef.current = arreter
  annulerRef.current = annuler
  const etatRef = useRef<Etat>('repos')

  /**
   * Règle la veille sur l'état courant.
   *
   * Pendant qu'on lui parle, elle reste ouverte mais change d'oreille : elle
   * n'attend plus son nom, elle guette « c'est bon » et « laisse tomber ».
   * C'est le seul moyen de finir à la voix ce qu'on a commencé à la voix.
   *
   * Appelé à chaque changement d'état **et** quand la veille finit de charger :
   * elle met quelques secondes, et un appel arrivé entre-temps la laissait
   * guetter son nom au lieu des commandes.
   */
  const accorderVeille = useCallback((): void => {
    const veille = veilleRef.current
    if (!veille) return
    veille.journal = (ligne) => window.api.noter(ligne)
    veille.surCommande = (commande) => {
      window.api.noter(`commande vocale : ${commande}`)
      if (commande === 'envoyer') arreterRef.current()
      else annulerRef.current()
    }
    const etatCourant = etatRef.current
    // Pendant qu'elle parle aussi : son nom l'interrompt. La veille était
    // coupée de peur qu'Iris s'entende elle-même, mais l'annulation d'écho du
    // micro retire déjà ce que le PC joue ; on ne pouvait plus la couper.
    if (etatCourant === 'repos' || etatCourant === 'parole') {
      veille.ecouterEn('appel')
      veille.reprendre()
    } else if (etatCourant === 'ecoute') {
      veille.ecouterEn('commande')
      veille.reprendre()
    } else {
      veille.suspendre()
    }
  }, [])

  // ─── Branchements ─────────────────────────────────────────────────────────

  useEffect(() => {
    lectureRef.current = new FileLecture(() => {
      setAnalyseur(null)
      window.api.noter('lecture finie')
      window.api.paroleFinie()
    })
    return () => lectureRef.current?.taire()
  }, [])

  useEffect(() => {
    void window.api.etat().then(setEtat)
    void window.api.forme().then(setForme)

    const off = [
      window.api.surEtat(setEtat),
      window.api.surForme((suivante) => {
        setForme(suivante)
        setSortie(false)
      }),
      window.api.surFormePart(() => setSortie(true)),
      window.api.surAnnonce(setAnnonce),
      window.api.surDemarrerEcoute((reglages, mode) => void demarrer(reglages, mode !== 'demande')),
      window.api.surArreterEcoute(arreter),
      window.api.surAudio((base64) => {
        lectureRef.current?.ajouter(base64)
        // L'anneau passe sur la voix d'Iris : le nœud est le même d'une phrase
        // à l'autre, mais il n'existe qu'à la première lecture.
        const suivant = lectureRef.current?.analyseur ?? null
        if (suivant) setAnalyseur(suivant)
      }),
      window.api.surTaire(() => {
        lectureRef.current?.taire()
        ecouteRef.current++
        arreterTout()
        // La barre va être masquée : sans ce nettoyage, elle réapparaissait au
        // tour suivant avec le message d'erreur du précédent.
        setSouci(null)
        setOutil(null)
      }),
      // La dernière synthèse a échoué après que la lecture s'est tue : personne
      // d'autre ne dirait que la réponse est finie, et Iris resterait figée.
      window.api.surSynthesesFinies(() => {
        if (!lectureRef.current?.enLecture) window.api.paroleFinie()
      }),
      window.api.surTour((tour) => {
        if (tour.role === 'moi') setQuestion(tour.texte)
        else {
          setReponse('')
          setOutil(null)
          setTaches([])
        }
      }),
      window.api.surEvenement((e) => {
        if (e.type === 'texte') setReponse((t) => t + e.delta)
        else if (e.type === 'outil') setOutil(e.outil.libelle || e.outil.nom)
        else if (e.type === 'taches') setTaches(e.taches)
        else if (e.type === 'fin') {
          setOutil(null)
          if (e.texte) setReponse(e.texte)
          // Le message du main est déjà une phrase qui dit quoi faire : le
          // coiffer d'un « Iris a échoué » ne faisait que voler la place.
          if (e.erreur) setSouci({ titre: e.erreur })
        }
      })
    ]
    return () => off.forEach((f) => f())
  }, [demarrer, arreter, arreterTout])

  useEffect(prechaufferAudio, [])

  // ─── Veille ───────────────────────────────────────────────────────────────

  /**
   * Le réveil au mot « Iris ».
   *
   * Elle vit dans cette fenêtre parce que c'est la seule qui reste chargée en
   * permanence. Le modèle pèse quarante mégaoctets et met quelques secondes à
   * se déballer : on ne l'ouvre qu'une fois, et seulement si le réglage est
   * coché.
   */
  useEffect(() => {
    let demande = false

    const ouvrir = async (): Promise<void> => {
      if (demande) return
      demande = true
      const octets = await window.api.modeleVeille()
      if (!octets) return
      try {
        const { Veille } = await import('@renderer/lib/veille')
        veilleRef.current = await Veille.partagee(
          octets,
          reglagesRef.current?.peripherique ?? '',
          () => window.api.motEntendu()
        )
        window.api.noter('veille prête')
        accorderVeille()
      } catch (err) {
        // Micro refusé, modèle illisible : le raccourci reste la voie d'entrée.
        window.api.noter(`veille indisponible : ${String(err).slice(0, 120)}`)
        demande = false
      }
    }

    const appliquer = (r: Reglages): void => {
      reglagesRef.current = r
      if (r.veille) void ouvrir()
      else if (veilleRef.current) {
        veilleRef.current.arreter()
        veilleRef.current = null
        demande = false
      }
    }

    void window.api.reglages().then(appliquer)
    // On ne ferme pas la veille au démontage : cette fenêtre vit aussi
    // longtemps que l'application, et le démontage n'arrive qu'en
    // développement, où il relancerait un déballage de quarante mégaoctets.
    return window.api.surReglages(appliquer)
  }, [])

  /**
   * Iris ne s'écoute pas parler : pendant qu'elle répond, sa propre voix
   * sortant des enceintes prononce parfois son nom, et la veille rouvrirait le
   * micro au milieu de sa phrase.
   */
  useEffect(() => {
    etatRef.current = etat
    accorderVeille()
  }, [etat, accorderVeille])

  // Le compteur sert deux fois : la durée parlée pendant l'écoute (les
  // services de transcription facturent à la durée), et le temps de travail
  // affiché sous la pastille.
  useEffect(() => {
    if (etat !== 'ecoute' && etat !== 'reflexion') return
    const debut = Date.now()
    setSecondes(0)
    const t = setInterval(() => setSecondes(Math.floor((Date.now() - debut) / 1000)), 250)
    return () => clearInterval(t)
  }, [etat])

  // ─── Rendu ────────────────────────────────────────────────────────────────

  const chrono = `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, '0')}`
  const travaille = etat === 'reflexion' || etat === 'parole' || etat === 'transcription'
  const affiche: Etat = souci ? 'erreur' : etat
  const tacheEnCours = taches.find((t) => t.statut === 'in_progress') ?? null

  if (forme === 'pastille') {
    return (
      <div
        className={cn(
          'flex h-full items-center justify-end gap-3 pr-1',
          sortie && 'animate-retrait'
        )}
      >
        {/* À gauche de l'orbe, ce qu'elle est en train de faire : sa liste
            de tâches, comme Claude Code la tient, et l'action du moment. */}
        <Bulles taches={taches} activite={tacheEnCours ? null : outil} />
        {/* La pastille a sa propre bulle. Sans fond, l'anneau flottait sur la
            fenêtre d'en dessous, et la barre de défilement ou les boutons de
            celle-ci semblaient en faire partie. */}
        <button
          onClick={() => window.api.deplier()}
          // La fenêtre laisse passer les clics hors de ce bouton : on ne les
          // reprend qu'au survol, sans quoi elle bloquerait tout derrière elle.
          onMouseEnter={() => window.api.survol(true)}
          onMouseLeave={() => window.api.survol(false)}
          title="Ramener Iris en face"
          className="animate-arrivee group relative grid h-[80px] w-[80px] flex-shrink-0 place-items-center rounded-full border border-shell-border bg-shell/95 shadow-[0_2px_10px_oklch(0_0_0/0.35)]"
        >
          <Anneau analyseur={analyseur} etat={affiche} taille={72} surNiveau={setNiveau} />
          <Orbe etat={affiche} niveau={niveau} dansAnneau className="absolute h-6 w-6" />
          {/* Le temps écoulé dit « je travaille encore » mieux qu'une animation
              seule. Il reste dans la bulle : en dessous, il sortait du cadre. */}
          <span className="absolute bottom-2 font-mono text-[9px] tabular-nums text-shell-muted opacity-0 transition-opacity group-hover:opacity-100">
            {chrono}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group relative h-full w-full overflow-hidden',
        sortie ? 'animate-retrait' : 'animate-arrivee'
      )}
    >
      {/* Nappe : une flaque de lumière qui s'éteint avant les bords, plutôt
          qu'un panneau à bordure. La fenêtre est transparente et Chromium ne
          sait pas flouter le bureau derrière : l'effet vient du dégradé. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_58%,oklch(var(--shell)/0.97),oklch(var(--shell)/0.9)_38%,oklch(var(--shell)/0)_72%)]" />
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{ opacity: 0.25 + niveau * 0.45 }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,oklch(var(--iris)/0.22),transparent_52%)]" />
      </div>

      <div className="relative flex h-full flex-col items-center justify-center gap-4 px-8">
        {/* L'orbe est un bouton : le même geste que le raccourci. Pendant
            l'écoute il envoie, pendant le travail il coupe, au repos il ouvre
            le micro. On la cliquait sans que rien ne se passe. */}
        <button
          onClick={() => window.api.basculer()}
          title={etat === 'ecoute' ? 'Envoyer' : travaille ? 'Couper' : 'Parler'}
          className="relative grid place-items-center rounded-full outline-none transition-transform active:scale-95"
        >
          <Anneau analyseur={analyseur} etat={affiche} taille={196} surNiveau={setNiveau} />
          <Orbe etat={affiche} niveau={niveau} dansAnneau className="absolute h-14 w-14" />
        </button>

        <div className="flex min-h-[72px] w-full max-w-[420px] flex-col items-center gap-1.5 text-center">
          {souci ? (
            <>
              <p className="line-clamp-2 font-medium text-destructive">{souci.titre}</p>
              {souci.detail && (
                <p className="line-clamp-2 text-[11px] text-shell-muted">{souci.detail}</p>
              )}
            </>
          ) : etat === 'ecoute' ? (
            <>
              {enSuite && reponse ? (
                <p className="line-clamp-2 text-[15px] leading-relaxed text-shell-foreground">
                  {reponse}
                </p>
              ) : (
                <p className="text-[15px] text-shell-foreground">{accueil}</p>
              )}
              {/* Seule indication de l'écran : sans elle, rien ne dit que le
                  silence suffit à finir, ni qu'on peut répondre sans la
                  rappeler. */}
              <p className="text-[11px] text-shell-muted">
                {enSuite ? (
                  'Je t’écoute encore'
                ) : (
                  <>
                    <span className="font-mono tabular-nums">{chrono}</span> · une pause et
                    j’envoie
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              {question && (
                <p className="line-clamp-1 text-[11px] text-shell-muted">{question}</p>
              )}
              {reponse ? (
                <p className="line-clamp-3 text-[15px] leading-relaxed text-shell-foreground">
                  {reponse}
                </p>
              ) : travaille ? (
                <p className="animate-shimmer bg-[linear-gradient(90deg,theme(colors.shell.muted),theme(colors.shell.foreground),theme(colors.shell.muted))] bg-[length:200%_100%] bg-clip-text text-[15px] text-transparent">
                  {etat === 'transcription' ? 'Un instant…' : 'Je m’en occupe…'}
                </p>
              ) : (
                <p
                  className={cn(
                    'text-[15px]',
                    annonce ? 'text-shell-foreground' : 'text-shell-muted'
                  )}
                >
                  {annonce ?? accueil}
                </p>
              )}
              {/* En face, une seule bulle : la tâche en cours, ou à défaut
                  l'action du moment. La liste entière vit dans la pastille,
                  où Iris se range dès que le travail dure. */}
              {travaille && tacheEnCours ? (
                <div className="mt-1">
                  <BulleTache tache={tacheEnCours} index={0} />
                </div>
              ) : travaille && outil ? (
                <div className="mt-1">
                  <BulleActivite libelle={outil} />
                </div>
              ) : !travaille || etat === 'parole' ? (
                <div className="mt-1">
                  <BilanTaches taches={taches} />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Les commandes ne se montrent qu'au survol : en face de soi, des
          icônes permanentes feraient de la barre une fenêtre d'application.
          Pas de bouton vers l'historique : Iris s'écoute, elle ne se lit pas. */}
      <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <button
          onClick={() => window.api.ouvrirParametres()}
          title="Paramètres"
          className="flex h-7 w-7 items-center justify-center rounded-md text-shell-muted transition-colors hover:bg-shell-raised hover:text-shell-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => window.api.congedier()}
          title={travaille ? 'Couper' : 'Fermer'}
          className="flex h-7 w-7 items-center justify-center rounded-md text-shell-muted transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          {travaille ? <Square className="h-3 w-3" /> : <X className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  )
}
