import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, RefreshCw, Volume2 } from 'lucide-react'
import {
  COULEURS,
  FOURNISSEURS,
  LANGUES,
  MODELES,
  PERMISSIONS,
  SONS,
  TONS,
  VOIX,
  type Couleur,
  type Permission,
  type Reglages,
  type SonDemarrage
} from '@shared/reglages'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Select } from '@renderer/components/ui/select'
import { Separator } from '@renderer/components/ui/separator'
import { Switch } from '@renderer/components/ui/switch'
import { appliquerCouleur, useSyncedTheme } from '@renderer/lib/theme'
import { cn } from '@renderer/lib/utils'

/** Débits proposés, en pourcentage relatif tel que l'attend le service. */
const DEBITS = [
  { value: '-10%', label: 'Posé' },
  { value: '+0%', label: 'Normal' },
  { value: '+8%', label: 'Vif' },
  { value: '+20%', label: 'Rapide' }
]

/** Une ligne libellé / contrôle, qui porte aussi son aide. */
function Ligne({
  titre,
  aide,
  children
}: {
  titre: string
  aide?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label>{titre}</Label>
      {children}
      {aide && <p className="text-[11px] leading-snug text-shell-muted">{aide}</p>}
    </div>
  )
}

export default function Parametres(): JSX.Element {
  useSyncedTheme()

  const [reglages, setReglages] = useState<Reglages | null>(null)
  const [micros, setMicros] = useState<MediaDeviceInfo[]>([])
  const [erreur, setErreur] = useState('')
  const [enregistre, setEnregistre] = useState(false)
  const [version, setVersion] = useState('')
  const [capture, setCapture] = useState(false)
  const [testEnCours, setTestEnCours] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** `null` pendant la lecture : `claude mcp list` sonde chaque serveur, ça prend quelques secondes. */
  const [comptes, setComptes] = useState<{ nom: string; connecte: boolean }[] | null>(null)

  const listerComptes = useCallback(async (): Promise<void> => {
    setComptes(null)
    setComptes(await window.api.comptes())
  }, [])

  useEffect(() => {
    void window.api.reglages().then(setReglages)
    void window.api.version().then(setVersion)
  }, [])

  /**
   * La liste des microphones ne porte de nom qu'une fois l'accès accordé : on
   * ouvre donc un flux, puis on le referme aussitôt. Le faire au démarrage
   * allumerait le témoin du micro sans que personne n'ait rien demandé, d'où
   * l'attente de l'ouverture de la fenêtre.
   */
  const listerMicros = useCallback(async (): Promise<void> => {
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: true })
      flux.getTracks().forEach((t) => t.stop())
    } catch {
      // Accès refusé : on liste quand même, les entrées seront anonymes.
    }
    const tous = await navigator.mediaDevices.enumerateDevices()
    setMicros(tous.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'))
  }, [])

  useEffect(() => {
    void listerMicros()
    void listerComptes()
    return window.api.surParametresAffiches(() => {
      void listerMicros()
      void listerComptes()
    })
  }, [listerMicros, listerComptes])

  const modifier = (champs: Partial<Reglages>): void => {
    setReglages((r) => (r ? { ...r, ...champs } : r))
    setEnregistre(false)
    setErreur('')
  }

  const enregistrer = async (): Promise<void> => {
    if (!reglages) return
    const reponse = await window.api.enregistrerReglages(reglages)
    if (!reponse.ok) {
      setErreur(reponse.erreur ?? 'Échec de l’enregistrement.')
      return
    }
    setErreur('')
    setEnregistre(true)
    setTimeout(() => setEnregistre(false), 2000)
  }

  const tester = async (): Promise<void> => {
    if (!reglages) return
    setTestEnCours(true)
    try {
      const base64 = await window.api.testerVoix(reglages)
      audioRef.current?.pause()
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`)
      audioRef.current = audio
      await audio.play()
    } catch (err) {
      setErreur(`La voix n’a pas répondu : ${String(err).slice(0, 120)}`)
    } finally {
      setTestEnCours(false)
    }
  }

  /**
   * Saisie du raccourci à la volée : on écrit l'accélérateur attendu par
   * Electron plutôt que de demander à Lucas de connaître sa syntaxe.
   */
  const capturer = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    e.preventDefault()
    const touche = e.key
    // Une combinaison sans touche finale n'est pas un raccourci : on attend.
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(touche)) return

    const parties: string[] = []
    if (e.ctrlKey) parties.push('Ctrl')
    if (e.altKey) parties.push('Alt')
    if (e.shiftKey) parties.push('Shift')
    if (e.metaKey) parties.push('Super')

    const nom =
      touche === ' '
        ? 'Space'
        : touche.length === 1
          ? touche.toUpperCase()
          : touche.replace('Arrow', '')
    parties.push(nom)

    // Une touche seule serait attrapée partout, y compris en pleine frappe.
    if (parties.length < 2) return
    modifier({ raccourci: parties.join('+') })
    setCapture(false)
  }

  if (!reglages) return <div className="h-full bg-shell" />

  const fournisseur = FOURNISSEURS[reglages.fournisseur]
  const cleAttendue = !reglages.cleApi || reglages.cleApi.startsWith(fournisseur.prefixe)

  return (
    <div className="flex h-full flex-col bg-shell text-shell-foreground">
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <section className="space-y-3">
          <h2 className="font-medium">Écoute</h2>

          <Ligne
            titre="Raccourci"
            aide="Une pression ouvre le micro, la suivante envoie. Pendant qu’Iris travaille, la même touche la coupe."
          >
            <Input
              readOnly
              value={capture ? 'Appuyez sur la combinaison…' : reglages.raccourci}
              onFocus={() => setCapture(true)}
              onBlur={() => setCapture(false)}
              onKeyDown={capturer}
              className={cn('cursor-pointer font-mono', capture && 'ring-[3px] ring-ring/40')}
            />
          </Ligne>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Réveil au mot « Iris »</Label>
              <p className="text-[11px] leading-snug text-shell-muted">
                Le micro reste ouvert et guette ce seul mot. La reconnaissance est locale, rien ne
                sort de la machine, et son nom l’interrompt quand elle parle.
              </p>
            </div>
            <Switch checked={reglages.veille} onCheckedChange={(veille) => modifier({ veille })} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Rester à l’écoute après une réponse</Label>
              <p className="text-[11px] leading-snug text-shell-muted">
                Le micro se rouvre six secondes pour répondre sans redire « Iris ». « Non »
                ou « ça ira » ferme la conversation.
              </p>
            </div>
            <Switch checked={reglages.suite} onCheckedChange={(suite) => modifier({ suite })} />
          </div>

          <Ligne titre="Microphone">
            <Select
              value={reglages.peripherique}
              onChange={(e) => modifier({ peripherique: e.target.value })}
            >
              <option value="">Micro par défaut du système</option>
              {micros.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || 'Microphone'}
                </option>
              ))}
            </Select>
          </Ligne>

          <div className="grid grid-cols-2 gap-3">
            <Ligne titre="Transcription">
              <Select
                value={reglages.fournisseur}
                onChange={(e) =>
                  modifier({ fournisseur: e.target.value as Reglages['fournisseur'] })
                }
              >
                {Object.entries(FOURNISSEURS).map(([cle, f]) => (
                  <option key={cle} value={cle}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </Ligne>
            <Ligne titre="Langue">
              <Select value={reglages.langue} onChange={(e) => modifier({ langue: e.target.value })}>
                {LANGUES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Ligne>
          </div>

          <Ligne titre="Clé de transcription" aide={fournisseur.aide}>
            <Input
              type="password"
              value={reglages.cleApi}
              placeholder={`${fournisseur.prefixe}…`}
              onChange={(e) => modifier({ cleApi: e.target.value.trim() })}
              className={cn(!cleAttendue && 'ring-[3px] ring-destructive/40')}
            />
          </Ligne>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-medium">Voix</h2>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Lire les réponses à voix haute</Label>
              <p className="text-[11px] text-shell-muted">
                Décoché, Iris répond par écrit dans la conversation.
              </p>
            </div>
            <Switch
              checked={reglages.parler}
              onCheckedChange={(parler) => modifier({ parler })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Ligne titre="Timbre">
              <Select value={reglages.voix} onChange={(e) => modifier({ voix: e.target.value })}>
                {VOIX.map((v) => (
                  <option key={v.value} value={v.value}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Ligne>
            <Ligne titre="Débit">
              <Select value={reglages.debit} onChange={(e) => modifier({ debit: e.target.value })}>
                {DEBITS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            </Ligne>
          </div>

          <Ligne titre="Ton">
            <Select
              value={reglages.ton}
              onChange={(e) => modifier({ ton: e.target.value as Reglages['ton'] })}
            >
              {Object.entries(TONS).map(([cle, t]) => (
                <option key={cle} value={cle}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Ligne>

          <Button variant="outline" size="sm" onClick={tester} disabled={testEnCours}>
            <Volume2 className="mr-1.5 h-3.5 w-3.5" />
            {testEnCours ? 'Synthèse…' : 'Écouter un exemple'}
          </Button>
          <p className="text-[11px] leading-snug text-shell-muted">
            Voix de la lecture à voix haute de Microsoft Edge : gratuite et sans clé. Les timbres
            « multilingues » prononcent correctement les mots anglais dans une phrase française.
          </p>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-medium">Apparence</h2>

          <Ligne
            titre="Couleur"
            aide="Elle ne colore que ce qui est vivant : l’anneau, l’orbe, les accents."
          >
            {/* Des pastilles plutôt qu'une liste déroulante : on choisit une
                couleur en la voyant, pas en lisant son nom. */}
            <div className="flex flex-wrap gap-2">
              {Object.entries(COULEURS).map(([cle, gamme]) => (
                <button
                  key={cle}
                  title={gamme.label}
                  onClick={() => {
                    // Posée tout de suite : on juge la couleur sur l'écran,
                    // pas après avoir enregistré.
                    appliquerCouleur(cle as Couleur)
                    modifier({ couleur: cle as Couleur })
                  }}
                  className={cn(
                    'h-7 w-7 rounded-full ring-offset-2 ring-offset-shell transition',
                    reglages.couleur === cle ? 'ring-2 ring-shell-foreground' : 'hover:scale-110'
                  )}
                  style={{
                    background: `oklch(0.62 ${0.18 * gamme.chroma} ${gamme.teinte})`
                  }}
                />
              ))}
            </div>
          </Ligne>

          <Ligne titre="Son de démarrage" aide="Il ne se joue qu’au lancement d’Iris.">
            <div className="flex gap-2">
              <Select
                value={reglages.sonDemarrage}
                onChange={(e) => modifier({ sonDemarrage: e.target.value as SonDemarrage })}
              >
                {Object.entries(SONS).map(([cle, label]) => (
                  <option key={cle} value={cle}>
                    {label}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="icon"
                title="Écouter"
                disabled={reglages.sonDemarrage === 'aucun'}
                onClick={async () => {
                  const base64 = await window.api.lireSon(reglages.sonDemarrage)
                  if (!base64) return
                  audioRef.current?.pause()
                  const audio = new Audio(`data:audio/wav;base64,${base64}`)
                  audio.volume = 0.45
                  audioRef.current = audio
                  await audio.play()
                }}
              >
                <Volume2 className="h-4 w-4" />
              </Button>
            </div>
          </Ligne>
        </section>

        <Separator />

        <section className="space-y-3">
          <h2 className="font-medium">Cerveau</h2>

          <p className="text-[11px] leading-snug text-shell-muted">
            Iris passe par le Claude Code installé sur cette machine : ce sont les jetons de votre
            abonnement, pas une facturation à l’appel.
          </p>

          <Ligne titre="Votre prénom" aide="Iris vous appelle ainsi. Vide, elle ne vous nomme pas.">
            <Input
              value={reglages.prenom}
              onChange={(e) => modifier({ prenom: e.target.value })}
              maxLength={40}
            />
          </Ligne>

          <Ligne titre="Modèle">
            <Select value={reglages.modele} onChange={(e) => modifier({ modele: e.target.value })}>
              {MODELES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Ligne>

          <Ligne titre="Dossier de travail" aide="Iris ne voit rien au-dessus de ce dossier.">
            <div className="flex gap-2">
              <Input
                value={reglages.dossier}
                onChange={(e) => modifier({ dossier: e.target.value })}
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                title="Choisir un dossier"
                onClick={async () => {
                  const choisi = await window.api.choisirDossier()
                  if (choisi) modifier({ dossier: choisi })
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </Ligne>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Lancer Iris au démarrage</Label>
              <p className="text-[11px] leading-snug text-shell-muted">
                Elle attend dans la zone de notification, sans rien ouvrir.
              </p>
            </div>
            <Switch
              checked={reglages.demarrageAuto}
              onCheckedChange={(demarrageAuto) => modifier({ demarrageAuto })}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>Accès à tout votre dossier utilisateur</Label>
              <p className="text-[11px] leading-snug text-shell-muted">
                Au-delà du dossier de travail et des dossiers usuels. Jamais Windows ni les
                programmes installés.
              </p>
            </div>
            <Switch checked={reglages.etendu} onCheckedChange={(etendu) => modifier({ etendu })} />
          </div>

          <Ligne titre="Autorisations" aide={PERMISSIONS[reglages.permission].aide}>
            <Select
              value={reglages.permission}
              onChange={(e) => modifier({ permission: e.target.value as Permission })}
            >
              {Object.entries(PERMISSIONS).map(([cle, p]) => (
                <option key={cle} value={cle}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Ligne>
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Comptes Figma</h2>
            <Button
              variant="ghost"
              size="icon"
              title="Actualiser"
              onClick={() => void listerComptes()}
              disabled={comptes === null}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', comptes === null && 'animate-spin')} />
            </Button>
          </div>

          <p className="text-[11px] leading-snug text-shell-muted">
            Un compte par serveur. La connexion s’ouvre dans Firefox en navigation privée : on s’y
            connecte avec le bon compte, sans risquer la session déjà ouverte. Iris sait aussi le
            faire à la voix.
          </p>

          {comptes === null ? (
            <p className="text-[11px] text-shell-muted">Vérification des comptes…</p>
          ) : comptes.length === 0 ? (
            <p className="text-[11px] text-shell-muted">
              Aucun serveur Figma déclaré pour le dossier de travail.
            </p>
          ) : (
            <div className="space-y-1.5">
              {comptes.map((c) => (
                <div
                  key={c.nom}
                  className="flex items-center gap-2.5 rounded-md border border-shell-border px-3 py-2"
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                      c.connecte ? 'bg-iris' : 'bg-shell-muted/40'
                    )}
                  />
                  <span className="flex-1 truncate font-mono text-xs">{c.nom}</span>
                  <span className="text-[11px] text-shell-muted">
                    {c.connecte ? 'Connecté' : 'À connecter'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.api.connecterCompte(c.nom)}
                  >
                    {c.connecte ? 'Reconnecter' : 'Connecter'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="flex flex-shrink-0 items-center gap-3 border-t border-shell-border px-5 py-3">
        <span className="text-[11px] text-shell-muted">Iris {version}</span>
        {erreur && <span className="flex-1 truncate text-[11px] text-destructive">{erreur}</span>}
        <Button className="ml-auto" onClick={enregistrer}>
          {enregistre ? (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5" /> Enregistré
            </>
          ) : (
            'Enregistrer'
          )}
        </Button>
      </footer>
    </div>
  )
}
