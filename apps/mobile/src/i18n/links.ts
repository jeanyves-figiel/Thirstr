// Strings for shared posts and linked accounts (#17, I-01). en / fr / de.
import { getLocales } from "expo-localization";

const en = {
  // S-44 share sheet
  shareTitle: "Share to chats",
  addMessage: "Add a message",
  search: "Search chats",
  recent: "Recent",
  upTo5: "Up to 5 chats",
  waits: "Waits for his reply",
  pick: "Pick a chat",
  sendTo: (n: number) => `Send to ${n}`,
  sent: (n: number) => (n === 1 ? "Sent to 1 chat" : `Sent to ${n} chats`),
  e2e: "Preview made on your phone · end-to-end encrypted",
  building: "Making the preview…",
  daily: "You’ve shared a lot today. Try again tomorrow.",
  noLink: "There’s no link to share in this.",
  notAvailable: "This link can’t be shared from here. It was sent as text.",
  noChats: "No chats yet. Start one from Explore.",
  // composer chip
  chipReady: "Preview ready",
  chipBuilding: "Making preview…",
  asText: "Send as plain text",
  // link card
  open: "Open",
  tapToView: "Tap to view",
  openTitle: (host: string) => `Open ${host}?`,
  openSub: (app: string | null) =>
    app ? `Opens in the ${app} app or your browser` : "Opens in your browser",
  openNote:
    "Thirstr doesn’t open it for you and doesn’t tell the site who sent it.",
  mixed: "This address mixes alphabets. Check it before you open it.",
  dontAsk: (host: string) => `Don’t ask again for ${host}`,
  copy: "Copy link",
  copyShort: "Copy",
  copied: "Link copied",
  cancel: "Cancel",
  reportConsent: "Report · Shared without consent",
  reportSpam: "Report · Spam or promotion",
  reported: "Reported. You won’t see this card again.",
  hiddenCard: "Link hidden after your report",
  more: "more",
  // settings
  adultPreviews: "Adult link previews",
  adultPreviewsSub: "OnlyFans, JustFor.Fans and posts marked adult.",
  adultOpts: { blur: "Blur", show: "Show", none: "No pictures" } as Record<
    string,
    string
  >,
  // S-63 linked accounts
  title: "Linked accounts",
  hint: "Show where else you are. A ✓ means we checked it’s really you.",
  rowSummary: (n: number, ok: number) =>
    n ? `${n} linked · ${ok} ✓` : "None yet",
  addCta: "Link an account",
  ofMax: (n: number) => `${n} of 5`,
  adultNote:
    "OnlyFans and JustFor.Fans show only in Hookup, never in Friends or Sport, and are hidden while Safe Mode is on.",
  states: {
    proven: "✓ PROVEN",
    manual_pending: "CHECKING BY HAND",
    unproven: "NOT PROVEN",
    none: "LINK ONLY",
  } as Record<string, string>,
  hiddenByReports: "Hidden after reports. We’re checking it.",
  step: (n: number) => `Step ${n} of 3`,
  pickPlatform: "Where is it?",
  handleLabel: "Username or profile link",
  whoSees: "Who sees it",
  next: "Next",
  proveTitle: "Prove it’s you",
  proveBody: (p: string) =>
    `Put this code anywhere in your ${p} bio, then tap Check now.`,
  proveBsky:
    "Put this code in your Bluesky bio or display name, then tap Check now.",
  openPlatform: (p: string) => `Open ${p}`,
  checkNow: "Check now",
  later: "Later (shown without ✓)",
  found: "Found. You can remove the code from your bio now.",
  notFound: (h: string) =>
    `We couldn’t find the code in @${h}’s bio. It can take a minute to show.`,
  manual:
    "Their page can’t be read automatically. We’ll check it by hand within 24 h.",
  taken: "This account is already proven on Thirstr. Report if it’s yours.",
  proveX:
    "Post this code on X from this account, then paste the post’s link here and tap Check now. You can delete the post once you have the ✓.",
  postOnX: "Post on X",
  postLink: "Link to your post",
  igNote: "Instagram can’t be checked yet. It shows as a link without ✓.",
  creatorNote:
    "Fine to show your page. Sending promo links to lots of people isn’t: that needs a Creator profile.",
  remove: "Remove",
  // profile view
  elsewhere: "Elsewhere",
  provenHint: "✓ = Thirstr checked he owns it. Tap to open outside the app.",
  notHis: "Not his account",
  reportThanks: "Thanks. We’ll look at it.",
};

type Strings = { [K in keyof typeof en]: (typeof en)[K] };

const fr: Strings = {
  shareTitle: "Partager dans des chats",
  addMessage: "Ajouter un message",
  search: "Chercher un chat",
  recent: "Récents",
  upTo5: "5 chats maximum",
  waits: "Attend sa réponse",
  pick: "Choisis un chat",
  sendTo: (n) => `Envoyer à ${n}`,
  sent: (n) => (n === 1 ? "Envoyé dans 1 chat" : `Envoyé dans ${n} chats`),
  e2e: "Aperçu créé sur ton téléphone · chiffré de bout en bout",
  building: "Création de l’aperçu…",
  daily: "Tu as beaucoup partagé aujourd’hui. Réessaie demain.",
  noLink: "Il n’y a pas de lien à partager ici.",
  notAvailable:
    "Ce lien ne peut pas être partagé d’ici. Il a été envoyé en texte.",
  noChats: "Pas encore de chat. Commence depuis Explorer.",
  chipReady: "Aperçu prêt",
  chipBuilding: "Création de l’aperçu…",
  asText: "Envoyer en texte simple",
  open: "Ouvrir",
  tapToView: "Toucher pour voir",
  openTitle: (h) => `Ouvrir ${h} ?`,
  openSub: (app) =>
    app
      ? `S’ouvre dans l’app ${app} ou ton navigateur`
      : "S’ouvre dans ton navigateur",
  openNote:
    "Thirstr ne l’ouvre pas pour toi et ne dit pas au site qui l’a envoyé.",
  mixed: "Cette adresse mélange des alphabets. Vérifie-la avant d’ouvrir.",
  dontAsk: (h) => `Ne plus demander pour ${h}`,
  copy: "Copier le lien",
  copyShort: "Copier",
  copied: "Lien copié",
  cancel: "Annuler",
  reportConsent: "Signaler · Partagé sans consentement",
  reportSpam: "Signaler · Spam ou promo",
  reported: "Signalé. Tu ne verras plus cette carte.",
  hiddenCard: "Lien masqué après ton signalement",
  more: "plus",
  adultPreviews: "Aperçus de liens adultes",
  adultPreviewsSub: "OnlyFans, JustFor.Fans et posts marqués adultes.",
  adultOpts: { blur: "Flouter", show: "Afficher", none: "Sans images" },
  title: "Comptes liés",
  hint: "Montre où tu es ailleurs. Un ✓ veut dire qu’on a vérifié que c’est bien toi.",
  rowSummary: (n, ok) => (n ? `${n} lié(s) · ${ok} ✓` : "Aucun"),
  addCta: "Lier un compte",
  ofMax: (n) => `${n} sur 5`,
  adultNote:
    "OnlyFans et JustFor.Fans n’apparaissent qu’en Plan, jamais en Amis ou Sport, et sont masqués en Mode sûr.",
  states: {
    proven: "✓ VÉRIFIÉ",
    manual_pending: "VÉRIF. MANUELLE",
    unproven: "NON VÉRIFIÉ",
    none: "LIEN SEUL",
  },
  hiddenByReports: "Masqué après des signalements. On vérifie.",
  step: (n) => `Étape ${n} sur 3`,
  pickPlatform: "C’est où ?",
  handleLabel: "Nom d’utilisateur ou lien du profil",
  whoSees: "Qui le voit",
  next: "Suivant",
  proveTitle: "Prouve que c’est toi",
  proveBody: (p) =>
    `Mets ce code n’importe où dans ta bio ${p}, puis touche Vérifier.`,
  proveBsky:
    "Mets ce code dans ta bio Bluesky ou ton nom affiché, puis touche Vérifier.",
  openPlatform: (p) => `Ouvrir ${p}`,
  checkNow: "Vérifier",
  later: "Plus tard (affiché sans ✓)",
  found: "Trouvé. Tu peux retirer le code de ta bio.",
  notFound: (h) =>
    `Code introuvable dans la bio de @${h}. Ça peut prendre une minute.`,
  manual:
    "Leur page ne se lit pas automatiquement. On la vérifie à la main sous 24 h.",
  taken: "Ce compte est déjà vérifié sur Thirstr. Signale-le si c’est le tien.",
  proveX:
    "Publie ce code sur X depuis ce compte, colle ici le lien du post, puis touche Vérifier. Tu peux supprimer le post une fois le ✓ obtenu.",
  postOnX: "Publier sur X",
  postLink: "Lien de ton post",
  igNote:
    "Instagram ne peut pas encore être vérifié. Il s’affiche comme lien sans ✓.",
  creatorNote:
    "Montrer ta page, c’est ok. Envoyer des liens promo à plein de monde, non : il faut un profil Créateur.",
  remove: "Retirer",
  elsewhere: "Ailleurs",
  provenHint:
    "✓ = Thirstr a vérifié que c’est son compte. Touche pour l’ouvrir hors de l’app.",
  notHis: "Ce n’est pas son compte",
  reportThanks: "Merci. On regarde.",
};

const de: Strings = {
  shareTitle: "In Chats teilen",
  addMessage: "Nachricht hinzufügen",
  search: "Chats suchen",
  recent: "Zuletzt",
  upTo5: "Bis zu 5 Chats",
  waits: "Wartet auf seine Antwort",
  pick: "Chat wählen",
  sendTo: (n) => `An ${n} senden`,
  sent: (n) => (n === 1 ? "In 1 Chat gesendet" : `In ${n} Chats gesendet`),
  e2e: "Vorschau auf deinem Handy erstellt · Ende-zu-Ende verschlüsselt",
  building: "Vorschau wird erstellt…",
  daily: "Du hast heute viel geteilt. Versuch es morgen wieder.",
  noLink: "Hier ist kein Link zum Teilen.",
  notAvailable:
    "Dieser Link kann hier nicht geteilt werden. Er ging als Text raus.",
  noChats: "Noch keine Chats. Starte einen in Entdecken.",
  chipReady: "Vorschau bereit",
  chipBuilding: "Vorschau wird erstellt…",
  asText: "Als Text senden",
  open: "Öffnen",
  tapToView: "Tippen zum Ansehen",
  openTitle: (h) => `${h} öffnen?`,
  openSub: (app) =>
    app
      ? `Öffnet in der ${app}-App oder deinem Browser`
      : "Öffnet in deinem Browser",
  openNote:
    "Thirstr öffnet ihn nicht für dich und sagt der Seite nicht, wer ihn geschickt hat.",
  mixed: "Diese Adresse mischt Alphabete. Prüf sie vor dem Öffnen.",
  dontAsk: (h) => `Für ${h} nicht mehr fragen`,
  copy: "Link kopieren",
  copyShort: "Kopieren",
  copied: "Link kopiert",
  cancel: "Abbrechen",
  reportConsent: "Melden · Ohne Zustimmung geteilt",
  reportSpam: "Melden · Spam oder Werbung",
  reported: "Gemeldet. Du siehst diese Karte nicht mehr.",
  hiddenCard: "Link nach deiner Meldung ausgeblendet",
  more: "mehr",
  adultPreviews: "Vorschau für Erwachsenen-Links",
  adultPreviewsSub: "OnlyFans, JustFor.Fans und als explizit markierte Posts.",
  adultOpts: { blur: "Unscharf", show: "Zeigen", none: "Ohne Bilder" },
  title: "Verknüpfte Konten",
  hint: "Zeig, wo du sonst bist. Ein ✓ heißt: Wir haben geprüft, dass du es bist.",
  rowSummary: (n, ok) => (n ? `${n} verknüpft · ${ok} ✓` : "Noch keine"),
  addCta: "Konto verknüpfen",
  ofMax: (n) => `${n} von 5`,
  adultNote:
    "OnlyFans und JustFor.Fans erscheinen nur bei Hookup, nie bei Freunde oder Sport, und sind im Safe Mode versteckt.",
  states: {
    proven: "✓ BESTÄTIGT",
    manual_pending: "WIRD GEPRÜFT",
    unproven: "NICHT BESTÄTIGT",
    none: "NUR LINK",
  },
  hiddenByReports: "Nach Meldungen ausgeblendet. Wir prüfen es.",
  step: (n) => `Schritt ${n} von 3`,
  pickPlatform: "Wo ist es?",
  handleLabel: "Benutzername oder Profil-Link",
  whoSees: "Wer es sieht",
  next: "Weiter",
  proveTitle: "Beweis, dass du es bist",
  proveBody: (p) =>
    `Setz diesen Code irgendwo in deine ${p}-Bio und tippe dann auf Jetzt prüfen.`,
  proveBsky:
    "Setz diesen Code in deine Bluesky-Bio oder deinen Anzeigenamen und tippe dann auf Jetzt prüfen.",
  openPlatform: (p) => `${p} öffnen`,
  checkNow: "Jetzt prüfen",
  later: "Später (ohne ✓ gezeigt)",
  found: "Gefunden. Du kannst den Code jetzt aus der Bio löschen.",
  notFound: (h) =>
    `Wir finden den Code nicht in der Bio von @${h}. Es kann eine Minute dauern.`,
  manual:
    "Die Seite lässt sich nicht automatisch lesen. Wir prüfen sie innerhalb von 24 h von Hand.",
  taken:
    "Dieses Konto ist schon auf Thirstr bestätigt. Melde es, wenn es deins ist.",
  proveX:
    "Poste diesen Code auf X von diesem Konto, füg hier den Link zum Post ein und tippe auf Jetzt prüfen. Nach dem ✓ kannst du den Post löschen.",
  postOnX: "Auf X posten",
  postLink: "Link zu deinem Post",
  igNote:
    "Instagram kann noch nicht geprüft werden. Es erscheint als Link ohne ✓.",
  creatorNote:
    "Deine Seite zeigen ist ok. Werbelinks an viele Leute schicken nicht: dafür braucht es ein Creator-Profil.",
  remove: "Entfernen",
  elsewhere: "Anderswo",
  provenHint:
    "✓ = Thirstr hat geprüft, dass es sein Konto ist. Tippen öffnet es außerhalb der App.",
  notHis: "Nicht sein Konto",
  reportThanks: "Danke. Wir sehen es uns an.",
};

const lang = getLocales()[0]?.languageCode ?? "en";
export const lx: Strings = lang === "fr" ? fr : lang === "de" ? de : en;
export const lxAll = { en, fr, de };
