import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ExternalLink, Loader2, Mic, RefreshCw, Volume2, X } from 'lucide-react'
import { FOURNISSEURS, VOIX, type Reglages } from '@shared/reglages'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { ouvrirMicro, ouvrirAnalyseur } from '@renderer/lib/micro'
import { useSyncedTheme } from '@renderer/lib/theme'
import { cn } from '@renderer/lib/utils'

/**
 * Le guide de démarrage.
 *
 * Au premier lancement, tout ce dont Iris a besoin manque encore : un prénom,
 * Claude Code connecté, une clé de transcription. Les paramètres les
 * demandaient sous forme de formulaire, ce qui suppose de savoir déjà ce que
 * chaque ligne veut dire. Ici, une chose à la fois, et chacune est vérifiée
 * pour de vrai plutôt que crue sur parole : la clé est essayée auprès du
 * service, le micro est écouté, la voix est entendue.
 *
 * La dernière étape n'installe rien : elle apprend quoi dire. C'est la
 * question que tout le monde pose devant un micro — « je dis quoi ? ».
 */

type Etape = {
  cle: string
  titre: string
  /** Une phrase sous le titre : ce que cette étape règle, pas sa redite. */
  sous: string
}

const ETAPES: Etape[] = [
  { cle: 'bonjour', titre: 'Bonjour', sous: 'Iris est une assistante à qui on parle.' },
  { cle: 'cerveau', titre: 'Son cerveau', sous: 'C’est Claude Code qui réfléchit et agit.' },
  { cle: 'oreille', titre: 'Son oreille', sous: 'Un service transcrit ce que vous dites.' },
  { cle: 'voix', titre: 'Sa voix', sous: 'Choisissez celle que vous voulez entendre.' },
  { cle: 'parler', titre: 'Lui parler', sous: 'Ce qu’on peut lui demander, et comment.' }
]

/** Les phrases d'exemple de la dernière étape, du plus simple au plus large. */
const EXEMPLES = [
  ['« Range mes captures d’écran par mois. »', 'Elle trie les fichiers, et vous dit ce qu’elle a fait.'],
  ['« Fais-moi un mot d’excuse pour l’école. »', 'Elle écrit le fichier et propose de l’ouvrir.'],
  ['« Où j’en étais hier ? »', 'Elle tient un journal de ce qu’elle fait avec vous.'],
  ['« Monte-moi une page web pour mon club. »', 'Elle crée le projet, l’installe et le lance.']
]

/** Ce qu'il faut savoir pour tenir une conversation, en trois gestes. */
const GESTES = [
  ['Pour l’appeler', 'Dites « Iris », ou appuyez sur Ctrl + Maj + Espace.'],
  ['Pour finir votre phrase', 'Taisez-vous une seconde ou deux. « C’est bon » l’envoie tout de suite.'],
  ['Pour l’arrêter', '« Laisse tomber », ou son nom pendant qu’elle parle.']
]

function Puce({ etat }: { etat: 'ok' | 'non' | 'attente' }): JSX.Element {
  if (etat === 'attente') return <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-shell-muted" />
  return etat === 'ok' ? (
    <Check className="h-4 w-4 flex-shrink-0 text-iris" />
  ) : (
    <X className="h-4 w-4 flex-shrink-0 text-destructive" />
  )
}

export default function Bienvenue(): JSX.Element {
  useSyncedTheme()

  const [reglages, setReglages] = useState<Reglages | null>(null)
  const [etape, setEtape] = useState(0)

  const [claude, setClaude] = useState<{
    installe: boolean
    version: string
    connecte: boolean | null
  } | null>(null)
  const [cleTestee, setCleTestee] = useState<{ ok: boolean; erreur?: string } | null>(null)
  const [testEnCours, setTestEnCours] = useState(false)
  const [niveau, setNiveau] = useState<number | null>(null)
  const [erreurMicro, setErreurMicro] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    void window.api.reglages().then(setReglages)
  }, [])

  const modifier = (champs: Partial<Reglages>): void =>
    setReglages((r) => (r ? { ...r, ...champs } : r))

  /** Chaque étape franchie est enregistrée : on peut fermer sans tout reprendre. */
  const enregistrer = useCallback(async (r: Reglages): Promise<void> => {
    await window.api.enregistrerReglages(r)
  }, [])

  const verifierClaude = useCallback(async (): Promise<void> => {
    setClaude(null)
    setClaude(await window.api.etatClaude())
  }, [])

  // La question est posée en arrivant sur l'étape, pas au chargement : elle
  // lance deux commandes et prend quelques secondes.
  useEffect(() => {
    if (ETAPES[etape].cle === 'cerveau' && !claude) void verifierClaude()
  }, [etape, claude, verifierClaude])

  const testerCle = async (): Promise<void> => {
    if (!reglages) return
    setTestEnCours(true)
    setCleTestee(await window.api.testerCle(reglages))
    setTestEnCours(false)
  }

  /** Trois secondes de micro : on voit bouger la barre, donc il écoute. */
  const testerMicro = async (): Promise<void> => {
    if (!reglages) return
    setErreurMicro('')
    try {
      const flux = await ouvrirMicro(reglages)
      const analyse = ouvrirAnalyseur(flux)
      const echantillons = new Float32Array(analyse.analyseur.fftSize)
      const tic = window.setInterval(() => {
        analyse.analyseur.getFloatTimeDomainData(echantillons)
        let somme = 0
        for (const v of echantillons) somme += v * v
        setNiveau(Math.min(1, Math.sqrt(somme / echantillons.length) * 8))
      }, 60)
      window.setTimeout(() => {
        window.clearInterval(tic)
        analyse.arreter()
        flux.getTracks().forEach((t) => t.stop())
        setNiveau(null)
      }, 4000)
    } catch (err) {
      setNiveau(null)
      setErreurMicro(
        (err as { souci?: { titre: string } })?.souci?.titre ?? 'Micro indisponible.'
      )
    }
  }

  const ecouterVoix = async (): Promise<void> => {
    if (!reglages) return
    try {
      const base64 = await window.api.testerVoix(reglages)
      audioRef.current?.pause()
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`)
      audioRef.current = audio
      await audio.play()
    } catch {
      // L'endpoint de la voix est injoignable : l'étape suivante reste
      // accessible, Iris peut travailler sans parler.
    }
  }

  if (!reglages) return <div className="h-full bg-shell" />

  const courante = ETAPES[etape]
  const fournisseur = FOURNISSEURS[reglages.fournisseur]
  const suivant = async (): Promise<void> => {
    await enregistrer(reglages)
    if (etape < ETAPES.length - 1) setEtape(etape + 1)
    else window.api.terminerBienvenue()
  }

  return (
    <div className="flex h-full flex-col bg-shell text-shell-foreground">
      {/* Les étapes franchies restent lisibles : on sait où on en est et
          combien il en reste, ce qu'une barre de progression ne dit pas. */}
      <nav className="flex flex-shrink-0 items-center gap-1.5 px-5 pt-5">
        {ETAPES.map((e, i) => (
          <button
            key={e.cle}
            onClick={() => i < etape && setEtape(i)}
            disabled={i > etape}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              i < etape ? 'bg-iris/60' : i === etape ? 'bg-iris' : 'bg-shell-raised'
            )}
            title={e.titre}
          />
        ))}
      </nav>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <header className="space-y-1">
          <h1 className="text-[22px] font-semibold tracking-tight">{courante.titre}</h1>
          <p className="text-[13px] text-shell-muted">{courante.sous}</p>
        </header>

        {courante.cle === 'bonjour' && (
          <section className="space-y-4">
            <p className="text-[13px] leading-relaxed text-shell-muted">
              Vous l’appelez, vous lui demandez quelque chose, elle le fait sur cet ordinateur
              et vous répond à voix haute. Trois réglages, et c’est parti.
            </p>
            <div className="space-y-1.5">
              <Label>Votre prénom</Label>
              <Input
                autoFocus
                value={reglages.prenom}
                maxLength={40}
                placeholder="Comment elle vous appelle"
                onChange={(e) => modifier({ prenom: e.target.value })}
              />
              <p className="text-[11px] text-shell-muted">
                Laissé vide, elle ne vous nommera pas.
              </p>
            </div>
          </section>
        )}

        {courante.cle === 'cerveau' && (
          <section className="space-y-4">
            <p className="text-[13px] leading-relaxed text-shell-muted">
              Iris ne réfléchit pas toute seule : elle passe par Claude Code, installé sur cette
              machine. C’est votre abonnement Claude qui travaille, il n’y a rien à payer en plus.
            </p>

            <div className="space-y-2 rounded-lg border border-shell-border p-4">
              <div className="flex items-center gap-2.5 text-[13px]">
                <Puce etat={!claude ? 'attente' : claude.installe ? 'ok' : 'non'} />
                <span>
                  {!claude
                    ? 'Recherche de Claude Code…'
                    : claude.installe
                      ? `Claude Code ${claude.version} est installé`
                      : 'Claude Code n’est pas installé'}
                </span>
              </div>
              {claude?.installe && (
                <div className="flex items-center gap-2.5 text-[13px]">
                  <Puce etat={claude.connecte === true ? 'ok' : claude.connecte === false ? 'non' : 'attente'} />
                  <span>
                    {claude.connecte === true
                      ? 'Il est connecté à votre compte'
                      : claude.connecte === false
                        ? 'Il n’est pas encore connecté'
                        : 'Connexion indéterminée'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {claude && !claude.installe && (
                <Button onClick={() => window.api.preparerClaude('installer')}>
                  Installer Claude Code
                </Button>
              )}
              {claude?.installe && claude.connecte !== true && (
                <Button onClick={() => window.api.preparerClaude('connexion')}>Se connecter</Button>
              )}
              <Button variant="outline" onClick={() => void verifierClaude()} disabled={!claude}>
                <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', !claude && 'animate-spin')} />
                Revérifier
              </Button>
            </div>

            <p className="text-[11px] leading-snug text-shell-muted">
              Une fenêtre noire s’ouvre et fait le travail. Revenez ici ensuite, et cliquez sur
              Revérifier. Il faut un abonnement Claude Pro ou Max.
            </p>
          </section>
        )}

        {courante.cle === 'oreille' && (
          <section className="space-y-4">
            <p className="text-[13px] leading-relaxed text-shell-muted">
              Pour comprendre ce que vous dites, Iris envoie votre voix à un service de
              transcription. Le compte est gratuit, la clé se crée en une minute et reste sur
              cette machine.
            </p>

            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select
                value={reglages.fournisseur}
                onChange={(e) => {
                  setCleTestee(null)
                  modifier({ fournisseur: e.target.value as Reglages['fournisseur'] })
                }}
              >
                {Object.entries(FOURNISSEURS).map(([cle, f]) => (
                  <option key={cle} value={cle}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>

            <Button variant="outline" size="sm" onClick={() => window.api.ouvrirLien(fournisseur.url)}>
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Créer une clé
            </Button>

            <div className="space-y-1.5">
              <Label>Votre clé</Label>
              <Input
                value={reglages.cleApi}
                placeholder={`${fournisseur.prefixe}…`}
                onChange={(e) => {
                  setCleTestee(null)
                  modifier({ cleApi: e.target.value.trim() })
                }}
                className="font-mono text-xs"
              />
              <p className="text-[11px] text-shell-muted">{fournisseur.aide}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={testerCle} disabled={testEnCours || !reglages.cleApi}>
                {testEnCours ? 'Vérification…' : 'Vérifier la clé'}
              </Button>
              {cleTestee && (
                <span
                  className={cn(
                    'text-[12px]',
                    cleTestee.ok ? 'text-iris' : 'text-destructive'
                  )}
                >
                  {cleTestee.ok ? 'La clé fonctionne.' : cleTestee.erreur}
                </span>
              )}
            </div>
          </section>
        )}

        {courante.cle === 'voix' && (
          <section className="space-y-4">
            <div className="space-y-1.5">
              <Label>Sa voix</Label>
              <Select value={reglages.voix} onChange={(e) => modifier({ voix: e.target.value })}>
                {VOIX.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-shell-muted">
                Gratuite et sans clé : ce sont les voix de lecture de Microsoft Edge.
              </p>
            </div>

            <Button variant="outline" size="sm" onClick={ecouterVoix}>
              <Volume2 className="mr-1.5 h-3.5 w-3.5" />
              L’écouter
            </Button>

            <div className="space-y-2 border-t border-shell-border pt-4">
              <Label>Votre micro</Label>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={testerMicro}>
                  <Mic className="mr-1.5 h-3.5 w-3.5" />
                  Dites quelque chose
                </Button>
                {/* Une barre qui suit la voix prouve le micro mieux qu'un nom
                    de périphérique dans une liste. */}
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-shell-raised">
                  <div
                    className="h-full rounded-full bg-iris transition-[width] duration-75"
                    style={{ width: `${(niveau ?? 0) * 100}%` }}
                  />
                </div>
              </div>
              {erreurMicro && <p className="text-[12px] text-destructive">{erreurMicro}</p>}
            </div>
          </section>
        )}

        {courante.cle === 'parler' && (
          <section className="space-y-5">
            <div className="space-y-2">
              {GESTES.map(([titre, texte]) => (
                <div key={titre} className="rounded-lg border border-shell-border p-3">
                  <p className="text-[13px] font-medium">{titre}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-shell-muted">{texte}</p>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Essayez, par exemple</Label>
              {EXEMPLES.map(([phrase, effet]) => (
                <div key={phrase} className="rounded-lg bg-shell-raised p-3">
                  <p className="text-[13px]">{phrase}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-shell-muted">{effet}</p>
                </div>
              ))}
            </div>

            <p className="text-[12px] leading-relaxed text-shell-muted">
              Elle travaille dans un seul dossier et ne voit rien au-dessus. Tout se change dans
              les paramètres, par l’icône près de l’horloge — c’est là qu’Iris vit.
            </p>
          </section>
        )}
      </div>

      <footer className="flex flex-shrink-0 items-center gap-3 border-t border-shell-border px-5 py-3">
        {etape > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setEtape(etape - 1)}>
            Retour
          </Button>
        )}
        <span className="flex-1" />
        {courante.cle !== 'parler' && courante.cle !== 'bonjour' && (
          <Button variant="ghost" size="sm" onClick={() => void suivant()}>
            Plus tard
          </Button>
        )}
        <Button onClick={() => void suivant()}>
          {courante.cle === 'parler' ? 'C’est parti' : 'Continuer'}
        </Button>
      </footer>
    </div>
  )
}
