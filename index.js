// ============================================================
//  🌸 BOT MAYSSA — Ticket + Protection + InviteLogger + Boost
//                + Blacklist + Lockname + Dog + DM
//  Render ready: keepalive Express + self-ping toutes les 2min
// ============================================================

const {
  Client, GatewayIntentBits, Partials, Collection,
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, PermissionFlagsBits,
  ChannelType, REST, Routes, SlashCommandBuilder,
  Events, AuditLogEvent, time
} = require('discord.js');
const express = require('express');
const fetch = require('node-fetch');

// ──────────────────────────────────────────────
//  CONFIG — Variables d'environnement Render
// ──────────────────────────────────────────────
const TOKEN            = process.env.TOKEN;
const CLIENT_ID        = process.env.CLIENT_ID || '1519233968749416498';
const GUILD_ID         = process.env.GUILD_ID  || '1515771169138147448';
const RENDER_URL       = process.env.RENDER_EXTERNAL_URL;

const OWNER_IDS_DEFAULT = ['207283656203436042', '685679698054742017'];

// ⚠️ Vérif rapide au démarrage — aide à diagnostiquer la perte du badge slash "/"
if (!TOKEN) console.error('❌ TOKEN manquant — vérifie les variables d\'environnement Render.');
if (!process.env.CLIENT_ID) console.warn('⚠️ CLIENT_ID non défini en variable d\'environnement Render, utilisation de la valeur par défaut codée en dur (risque de désync si ce n\'est pas le bon bot).');
if (!process.env.GUILD_ID) console.warn('⚠️ GUILD_ID non défini en variable d\'environnement Render, utilisation de la valeur par défaut codée en dur (risque de désync si ce n\'est pas le bon serveur).');

// ──────────────────────────────────────────────
//  STATE en mémoire
// ──────────────────────────────────────────────
const guildData = {};

function getGuild(guildId) {
  if (!guildData[guildId]) {
    guildData[guildId] = {
      ownerIds: [...OWNER_IDS_DEFAULT],

      panel: {
        title: '🦋 • SUPPORT TICKET • 🦋',
        description: '♡ ••••• ♡\n\n*• Tu as envie de commander une prestation de Mayssa ? Une question ? Ou autre ?*\n\n💋 **Ouvre un ticket parmis les options suivantes :**',
        selections: [
          { id: 'prestations', label: '• PRESTATIONS • 💋', description: 'Commande mes services ici !',       pingRoleId: null, categoryId: null },
          { id: 'questions',   label: '• QUESTIONS • 💋',   description: 'Des questions / demandes ?',        pingRoleId: null, categoryId: null },
          { id: 'partenariat', label: '• PARTENARIAT • 💋', description: 'Tu souhaites faire un partenariat avec Mayssa ?', pingRoleId: null, categoryId: null },
          { id: 'reports',     label: '• RECOMPENSE BOOST • 💋',     description: 'Pour réclamer tes récompenses de boosts',       pingRoleId: null , categoryId: null },
          { id: 'autres',      label: '• AUTRES • 💋',      description: 'Aborde un autre sujet ici !',       pingRoleId: null, categoryId: null },
        ],
      },

      tickets: {},
      ticketViewRoleId: null, // rôle qui peut voir TOUS les tickets en plus du créateur

      logsChannels: {
        tickets:    null,
        antiraid:   null,
        antispam:   null,
        antibot:    null,
        protection: null,
        sanctions:  null,
        advanced:   null,
        security:   null,
        boost:      null,
      },

      managerRoles: [],

      antiRaid: {
        enabled: false,
        joinTimestamps: [],
        quarantinedUsers: [],
        locked: false,
      },

      antiLink: {
        enabled: false,
        fullBypassRoles: [],
        gifOnlyBypassRoles: [],
      },

      antiSpam: {
        userMessages: {},
      },

      whitelist: [],
      rules: [],
      lockdown: false,
      maintenance: false,
      channelBackup: {},

      // ── INVITE LOGGER ──
      inviteLogger: {
        joinChannelId: null,
        leaveChannelId: null,
        inviteCache: {},     // code -> { uses, inviterId, inviterTag }
      },

      // ── ROLEMEMBER ──
      autoRoleId: null,    // rôle auto aux nouveaux arrivants

      // ── BLACKLIST (&bl) ──
      blacklist: {},        // userId -> { reason, byId, byTag, bySysPlus, timestamp }
      blRoleId: null,       // rôle autorisé (en plus de ownerbot) à utiliser &bl

      // ── LOCKNAME (,lockname) ──
      lockedNames: {},      // userId -> nom verrouillé

      // ── DOG (/dog) ──
      dogged: {},           // userId -> { masterId, originalNick }
      dogRoleId: null,      // rôle autorisé (en plus de ownerbot) à utiliser /dog

      // ── DM (/dm) ──
      dmRoleId: null,       // rôle autorisé (en plus de ownerbot) à utiliser /dm
    };
  }
  return guildData[guildId];
}

// ──────────────────────────────────────────────
//  CLIENT DISCORD
// ──────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildVoiceStates, // nécessaire pour le système /dog (laisse vocale)
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});

// ──────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────
function isOwner(guildId, userId) {
  return getGuild(guildId).ownerIds.includes(userId);
}

function isManager(guildId, member) {
  if (isOwner(guildId, member.id)) return true;
  const d = getGuild(guildId);
  return d.managerRoles.some(rId => member.roles.cache.has(rId));
}

function canClaimTicket(guildId, member, selectionId) {
  if (isOwner(guildId, member.id)) return true;
  const d = getGuild(guildId);
  const sel = d.panel.selections.find(s => s.id === selectionId);
  if (!sel || !sel.pingRoleId) return isManager(guildId, member);
  const pingRole = member.guild.roles.cache.get(sel.pingRoleId);
  if (!pingRole) return isManager(guildId, member);
  return member.roles.cache.some(r => r.position >= pingRole.position);
}

// ── Permissions catégories spéciales ──
function canUseBl(guildId, member) {
  if (isOwner(guildId, member.id)) return true;
  const d = getGuild(guildId);
  return !!(d.blRoleId && member.roles.cache.has(d.blRoleId));
}

function canUseDog(guildId, member) {
  if (isOwner(guildId, member.id)) return true;
  const d = getGuild(guildId);
  return !!(d.dogRoleId && member.roles.cache.has(d.dogRoleId));
}

function canUseDm(guildId, member) {
  if (isOwner(guildId, member.id)) return true;
  const d = getGuild(guildId);
  return !!(d.dmRoleId && member.roles.cache.has(d.dmRoleId));
}

// ── Extrait un ID Discord depuis une mention <@id> ou un ID brut ──
function extractIdFromArg(arg) {
  if (!arg) return null;
  const mention = arg.match(/^<@!?(\d{15,21})>$/);
  if (mention) return mention[1];
  if (/^\d{15,21}$/.test(arg)) return arg;
  return null;
}

async function sendLog(guild, logKey, embed) {
  try {
    const d = getGuild(guild.id);
    const chId = d.logsChannels[logKey];
    if (!chId) return;
    const ch = guild.channels.cache.get(chId);
    if (ch) await ch.send({ embeds: [embed] });
  } catch {}
}

async function ensureLogCategory(guild) {
  const d = getGuild(guild.id);
  const LOG_CHANNELS = [
    { key: 'tickets',    name: '🎫・logs-tickets'    },
    { key: 'antiraid',   name: '🛡️・logs-antiraid'   },
    { key: 'antispam',   name: '🚫・logs-antispam'   },
    { key: 'antibot',    name: '🤖・logs-antibot'    },
    { key: 'protection', name: '🔨・logs-protection' },
    { key: 'sanctions',  name: '👮・logs-sanctions'  },
    { key: 'advanced',   name: '📜・logs-avancés'    },
    { key: 'security',   name: '⚙️・logs-sécurité'   },
    { key: 'boost',      name: '🚀・logs-boost'      },
  ];

  let cat = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === '📋 LOGS BOT');
  if (!cat) {
    cat = await guild.channels.create({
      name: '📋 LOGS BOT',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });
  }

  for (const { key, name } of LOG_CHANNELS) {
    if (d.logsChannels[key]) {
      const existing = guild.channels.cache.get(d.logsChannels[key]);
      if (existing) continue;
    }
    const existing = guild.channels.cache.find(c => c.name === name && c.parentId === cat.id);
    if (existing) {
      d.logsChannels[key] = existing.id;
      continue;
    }
    const ch = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: cat.id,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      ],
    });
    d.logsChannels[key] = ch.id;
  }
}

// ──────────────────────────────────────────────
//  INVITE LOGGER HELPERS
// ──────────────────────────────────────────────
async function cacheInvites(guild) {
  try {
    const d = getGuild(guild.id);
    const invites = await guild.invites.fetch();
    d.inviteLogger.inviteCache = {};
    invites.forEach(inv => {
      d.inviteLogger.inviteCache[inv.code] = {
        uses: inv.uses,
        inviterId: inv.inviter?.id || null,
        inviterTag: inv.inviter?.username || 'Inconnu',
        inviterMention: inv.inviter ? `<@${inv.inviter.id}>` : 'Inconnu',
      };
    });
  } catch {}
}

// ──────────────────────────────────────────────
//  BUILD TICKET PANEL
// ──────────────────────────────────────────────
function buildPanelComponents(guildId) {
  const d = getGuild(guildId);
  const embed = new EmbedBuilder()
    .setTitle(d.panel.title)
    .setDescription(d.panel.description)
    .setColor(0x2b0a2b)
    .setFooter({ text: 'Mayssa • Call me Mayssa 💋' });

  const options = d.panel.selections.map(s => ({
    label: s.label,
    description: s.description,
    value: s.id,
    emoji: '💋',
  }));

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('ticket_open')
      .setPlaceholder('💋 Sélectionne une raison...')
      .addOptions(options)
  );

  return { embed, row };
}

// ──────────────────────────────────────────────
//  COMPTE À REBOURS DE FERMETURE (1 seul embed édité)
// ──────────────────────────────────────────────
async function sendCloseCountdown(channel) {
  const makeEmbed = (n) => new EmbedBuilder()
    .setTitle('🔒 Fermeture du ticket')
    .setDescription(`Ce ticket sera fermé dans **${n}**...`)
    .setColor(0xff4444);

  const msg = await channel.send({ embeds: [makeEmbed(5)] });
  for (let i = 4; i >= 0; i--) {
    await new Promise(r => setTimeout(r, 1000));
    try { await msg.edit({ embeds: [makeEmbed(i)] }); } catch {}
  }
  await new Promise(r => setTimeout(r, 1000));
}

// ──────────────────────────────────────────────
//  SLASH COMMANDS (liste unique, sans doublons)
// ──────────────────────────────────────────────
const commands = [
  // ── OWNER ──
  new SlashCommandBuilder().setName('addown').setDescription('Ajouter un owner bot')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(true)),
  new SlashCommandBuilder().setName('delown').setDescription('Retirer un owner bot')
    .addUserOption(o => o.setName('user').setDescription('Utilisateur').setRequired(true)),
  new SlashCommandBuilder().setName('ownlist').setDescription('Liste des owners bot'),

  // ── PANEL ──
  new SlashCommandBuilder().setName('paneltitle').setDescription('Modifier le titre du panel ticket')
    .addStringOption(o => o.setName('titre').setDescription('Nouveau titre').setRequired(true)),
  new SlashCommandBuilder().setName('paneldescription').setDescription('Modifier la description du panel')
    .addStringOption(o => o.setName('desc').setDescription('Nouvelle description').setRequired(true)),
  new SlashCommandBuilder().setName('panelselection').setDescription('Ajouter une option au panel ticket')
    .addStringOption(o => o.setName('id').setDescription('ID unique (ex: vip)').setRequired(true))
    .addStringOption(o => o.setName('label').setDescription('Label affiché').setRequired(true))
    .addStringOption(o => o.setName('description').setDescription('Description').setRequired(true)),
  new SlashCommandBuilder().setName('paneldelselection').setDescription('Retirer une option du panel')
    .addStringOption(o => o.setName('id').setDescription('ID de la sélection').setRequired(true)),
  new SlashCommandBuilder().setName('panelsetpingrole').setDescription('Définir le rôle pingé pour une raison')
    .addStringOption(o => o.setName('id').setDescription('ID de la sélection').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Rôle à pinger').setRequired(true)),
  new SlashCommandBuilder().setName('panelsetcategory').setDescription('Définir la catégorie pour une raison')
    .addStringOption(o => o.setName('id').setDescription('ID de la sélection').setRequired(true))
    .addChannelOption(o => o.setName('categorie').setDescription('Catégorie').setRequired(true)),
  new SlashCommandBuilder().setName('panel').setDescription('Envoyer le panel ticket dans ce salon'),

  // ── TICKET ──
  new SlashCommandBuilder().setName('add').setDescription('Ajouter un membre au ticket')
    .addUserOption(o => o.setName('user').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('remove').setDescription('Retirer un membre du ticket')
    .addUserOption(o => o.setName('user').setDescription('Membre').setRequired(true)),
  new SlashCommandBuilder().setName('close').setDescription('Fermer le ticket (compte à rebours 5s)'),
  new SlashCommandBuilder().setName('delete').setDescription('Supprimer immédiatement le ticket'),
  new SlashCommandBuilder().setName('rename').setDescription('Renommer le ticket')
    .addStringOption(o => o.setName('nom').setDescription('Nouveau nom').setRequired(true)),

  // ── SETUP ──
  new SlashCommandBuilder().setName('addmanagerole').setDescription('Autoriser un rôle à gérer les tickets')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('removemanagerole').setDescription('Retirer un rôle manager')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('listmanageroles').setDescription('Liste des rôles managers'),
  new SlashCommandBuilder().setName('setlogschannel').setDescription('Définir manuellement un salon de logs')
    .addStringOption(o => o.setName('type').setDescription('Type (tickets/antiraid/antispam/antibot/protection/sanctions/advanced/security/boost)').setRequired(true))
    .addChannelOption(o => o.setName('salon').setDescription('Salon').setRequired(true)),
  new SlashCommandBuilder().setName('setuplogs').setDescription('Créer automatiquement tous les salons de logs'),

  // ── ANTI-RAID / PROTECTION ──
  new SlashCommandBuilder().setName('antiraid').setDescription('Activer/Désactiver la protection anti-raid')
    .addStringOption(o => o.setName('action').setDescription('on / off').setRequired(true)
      .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' })),
  new SlashCommandBuilder().setName('antilink').setDescription('Activer/Désactiver l\'anti-lien')
    .addStringOption(o => o.setName('action').setDescription('on / off').setRequired(true)
      .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' })),
  new SlashCommandBuilder().setName('setbypassrole').setDescription('Rôle bypass total des liens')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('setgifonlyrole').setDescription('Rôle bypass gif uniquement')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('lockdown').setDescription('Mode urgence : verrouille tous les salons')
    .addStringOption(o => o.setName('action').setDescription('on / off').setRequired(true)
      .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' })),
  new SlashCommandBuilder().setName('maintenance').setDescription('Mode maintenance')
    .addStringOption(o => o.setName('action').setDescription('on / off').setRequired(true)
      .addChoices({ name: 'Activer', value: 'on' }, { name: 'Désactiver', value: 'off' })),
  new SlashCommandBuilder().setName('whitelist').setDescription('Gérer la whitelist admin')
    .addStringOption(o => o.setName('action').setDescription('add / remove / list').setRequired(true)
      .addChoices({ name: 'Ajouter', value: 'add' }, { name: 'Retirer', value: 'remove' }, { name: 'Liste', value: 'list' }))
    .addUserOption(o => o.setName('user').setDescription('Utilisateur')),

  // ── RÈGLEMENT ──
  new SlashCommandBuilder().setName('rule').setDescription('Envoyer le règlement avec réaction rôle')
    .addStringOption(o => o.setName('message').setDescription('Texte du règlement').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Rôle attribué après validation').setRequired(true)),

  // ── ROLEMEMBER ──
  new SlashCommandBuilder().setName('rolemember').setDescription('Donne un rôle à TOUS les membres + auto aux nouveaux')
    .addRoleOption(o => o.setName('role').setDescription('Rôle à attribuer').setRequired(true)),

  // ── SAY ──
  new SlashCommandBuilder().setName('say').setDescription('Envoyer un message ou embed dans un salon')
    .addChannelOption(o => o.setName('salon').setDescription('Salon cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Texte du message').setRequired(true))
    .addStringOption(o => o.setName('style').setDescription('Envoyer en embed ou texte simple').setRequired(true)
      .addChoices({ name: '💋 Embed (stylisé)', value: 'embed' }, { name: '💬 Texte simple', value: 'text' }))
    .addStringOption(o => o.setName('titre').setDescription('Titre de l\'embed (optionnel)'))
    .addStringOption(o => o.setName('couleur').setDescription('Couleur hex de l\'embed ex: #FF00AA (optionnel)')),

  // ── INVITE LOGGER ──
  new SlashCommandBuilder().setName('invitelogger').setDescription('Configurer le système d\'invite logger')
    .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true)
      .addChoices(
        { name: 'Définir salon arrivée', value: 'setjoin' },
        { name: 'Définir salon départ', value: 'setleave' },
        { name: 'Activer / Reset cache', value: 'enable' },
        { name: 'Voir config actuelle', value: 'status' },
      ))
    .addChannelOption(o => o.setName('salon').setDescription('Salon (pour setjoin / setleave)')),

  // ── RÔLES SPÉCIAUX (BL / DOG / DM / TICKET) ──
  new SlashCommandBuilder().setName('setblrole').setDescription('Définir le rôle autorisé à utiliser &bl (en plus de ownerbot)')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('setdogrole').setDescription('Définir le rôle autorisé à utiliser /dog (en plus de ownerbot)')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('setdmrole').setDescription('Définir le rôle autorisé à utiliser /dm (en plus de ownerbot)')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),
  new SlashCommandBuilder().setName('setticketrole').setDescription('Définir le rôle qui peut voir TOUS les tickets')
    .addRoleOption(o => o.setName('role').setDescription('Rôle').setRequired(true)),

  // ── DOG (laisse) ──
  new SlashCommandBuilder().setName('dog').setDescription('Mettre un membre en laisse')
    .addUserOption(o => o.setName('user').setDescription('Membre cible').setRequired(true)),
  new SlashCommandBuilder().setName('undog').setDescription('Retirer la laisse d\'un membre')
    .addUserOption(o => o.setName('user').setDescription('Membre cible').setRequired(true)),
  new SlashCommandBuilder().setName('undogalls').setDescription('Retirer la laisse de tout le monde'),
  new SlashCommandBuilder().setName('undoglist').setDescription('Liste des membres actuellement en laisse'),

  // ── DM ──
  new SlashCommandBuilder().setName('dm').setDescription('Envoyer un message privé à un membre')
    .addUserOption(o => o.setName('user').setDescription('Membre cible').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Contenu du message').setRequired(true))
    .addStringOption(o => o.setName('identite').setDescription('Afficher ou cacher ton identité').setRequired(true)
      .addChoices({ name: 'Cacher mon identité', value: 'cacher' }, { name: 'Afficher mon identité', value: 'afficher' })),

].map(c => c.toJSON());

// ──────────────────────────────────────────────
//  REGISTER SLASH COMMANDS (guild only, pas de global)
// ──────────────────────────────────────────────
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log(`📡 Enregistrement des commandes slash (guild) — CLIENT_ID=${CLIENT_ID} GUILD_ID=${GUILD_ID}...`);
    // On écrase proprement les commandes guild — aucun doublon possible
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    // On vide les commandes globales si elles existent (source de doublons)
    try {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
      console.log('🧹 Commandes globales vidées (anti-doublon).');
    } catch {}
    console.log('✅ Commandes enregistrées.');
  } catch (e) {
    console.error('❌ Erreur enregistrement commandes:', e?.code || '', e?.message || e);
    console.error('👉 Vérifie : 1) CLIENT_ID/GUILD_ID corrects, 2) le bot a bien été invité avec le scope "applications.commands", 3) le TOKEN est valide.');
  }
}

// ══════════════════════════════════════════════
//  EVENT: READY
// ══════════════════════════════════════════════
client.once(Events.ClientReady, async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  client.user.setPresence({ activities: [{ name: '💋 Mayssa • Call me Mayssa' }], status: 'dnd' });
  await registerCommands();

  for (const guild of client.guilds.cache.values()) {
    try { await ensureLogCategory(guild); } catch {}
    try { await cacheInvites(guild); } catch {}
    backupChannels(guild);
  }
});

client.on(Events.GuildCreate, async guild => {
  try { await ensureLogCategory(guild); } catch {}
  try { await cacheInvites(guild); } catch {}
});

// ══════════════════════════════════════════════
//  INVITE LOGGER — Mise à jour cache à chaque nouvelle invite
// ══════════════════════════════════════════════
client.on(Events.InviteCreate, async invite => {
  if (!invite.guild) return;
  await cacheInvites(invite.guild);
});

client.on(Events.InviteDelete, async invite => {
  if (!invite.guild) return;
  await cacheInvites(invite.guild);
});

// ══════════════════════════════════════════════
//  GUILDMEMBERADD — Blacklist + Auto-rôle + Invite Logger
// ══════════════════════════════════════════════
client.on(Events.GuildMemberAdd, async member => {
  const gId = member.guild.id;
  const d = getGuild(gId);

  // ── BLACKLIST : re-ban automatique si la personne tente de revenir ──
  if (d.blacklist[member.id]) {
    try { await member.ban({ reason: 'Blacklist active — re-ban automatique' }); } catch {}
    return;
  }

  // ── AUTO-RÔLE ──
  if (d.autoRoleId) {
    try {
      await member.roles.add(d.autoRoleId);
    } catch {}
  }

  // ── ANTI-RAID ──
  if (d.antiRaid.enabled) {
    const now = Date.now();
    d.antiRaid.joinTimestamps.push(now);
    d.antiRaid.joinTimestamps = d.antiRaid.joinTimestamps.filter(t => now - t < 20000);

    if (member.user.bot) {
      try {
        await member.kick('Anti-bot : ajout de bot non autorisé');
        const logEmbed = new EmbedBuilder()
          .setTitle('🤖 Bot Kické')
          .setDescription(`**Bot :** ${member.user.tag} (${member.id})`)
          .setColor(0xff0000).setTimestamp();
        await sendLog(member.guild, 'antibot', logEmbed);
      } catch {}
      return;
    }

    const accountAge = Date.now() - member.user.createdTimestamp;
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (accountAge < sevenDays) {
      const logEmbed = new EmbedBuilder()
        .setTitle('🤖 Compte Récent Détecté')
        .setDescription(`**Membre :** ${member.user.tag}\n**Créé il y a :** ${Math.floor(accountAge / 86400000)} jour(s)`)
        .setColor(0xffaa00).setTimestamp();
      await sendLog(member.guild, 'antibot', logEmbed);
    }

    const RAID_THRESHOLDS = [
      { count: 50, window: 20000, action: 'lockdown' },
      { count: 20, window: 15000, action: 'quarantine' },
      { count: 10, window: 10000, action: 'warn' },
    ];

    for (const threshold of RAID_THRESHOLDS) {
      const recent = d.antiRaid.joinTimestamps.filter(t => now - t < threshold.window).length;
      if (recent >= threshold.count) {
        if (threshold.action === 'lockdown' && !d.antiRaid.locked) {
          d.antiRaid.locked = true;
          try {
            const channels = member.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
            for (const [, ch] of channels) {
              try {
                await ch.permissionOverwrites.edit(member.guild.roles.everyone, { SendMessages: false });
              } catch {}
            }
          } catch {}
          const logEmbed = new EmbedBuilder()
            .setTitle('🚨 ANTI-RAID : LOCKDOWN AUTOMATIQUE')
            .setDescription(`**${recent} membres** ont rejoint en ${threshold.window / 1000}s.\nServeur verrouillé automatiquement.`)
            .setColor(0xff0000).setTimestamp();
          await sendLog(member.guild, 'antiraid', logEmbed);
        } else if (threshold.action === 'quarantine') {
          d.antiRaid.quarantinedUsers.push(member.id);
          try { await member.timeout(600000, 'Anti-raid : arrivée massive'); } catch {}
          const logEmbed = new EmbedBuilder()
            .setTitle('🛡️ ANTI-RAID : Quarantaine')
            .setDescription(`**Membre :** ${member.user.tag}\n**${recent} membres** ont rejoint récemment.`)
            .setColor(0xff8800).setTimestamp();
          await sendLog(member.guild, 'antiraid', logEmbed);
        } else {
          const logEmbed = new EmbedBuilder()
            .setTitle('⚠️ ANTI-RAID : Alerte Joins')
            .setDescription(`**${recent} membres** ont rejoint en ${threshold.window / 1000}s.`)
            .setColor(0xffff00).setTimestamp();
          await sendLog(member.guild, 'antiraid', logEmbed);
        }
        break;
      }
    }
  }

  // ── INVITE LOGGER : arrivée ──
  const il = d.inviteLogger;
  if (!il.joinChannelId) return;

  let usedInviter = null;
  let usedCode = null;
  let totalInvites = 0;

  try {
    const newInvites = await member.guild.invites.fetch();
    newInvites.forEach(inv => {
      const cached = il.inviteCache[inv.code];
      if (cached && inv.uses > cached.uses) {
        usedInviter = cached;
        usedCode = inv.code;
        totalInvites = inv.uses;
      }
    });
    // Rafraîchir le cache
    il.inviteCache = {};
    newInvites.forEach(inv => {
      il.inviteCache[inv.code] = {
        uses: inv.uses,
        inviterId: inv.inviter?.id || null,
        inviterTag: inv.inviter?.username || 'Inconnu',
        inviterMention: inv.inviter ? `<@${inv.inviter.id}>` : 'Inconnu',
      };
    });
  } catch {}

  const joinCh = member.guild.channels.cache.get(il.joinChannelId);
  if (!joinCh) return;

  const memberCount = member.guild.memberCount;
  const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);

  const joinEmbed = new EmbedBuilder()
    .setTitle('💋 Nouveau membre')
    .setDescription(
      `${member} vient de rejoindre le serveur !\n\n` +
      `**👤 Compte créé il y a :** ${accountAge} jour(s)\n` +
      `**💌 Invité par :** ${usedInviter ? usedInviter.inviterMention : '`Lien inconnu`'}\n` +
      `**🔗 Code utilisé :** ${usedCode ? `\`${usedCode}\`` : '`inconnu`'}\n` +
      `**📊 Total invites de l'inviteur :** ${usedInviter ? totalInvites : '–'}\n` +
      `**👥 Membres du serveur :** ${memberCount}`
    )
    .setColor(0xff69b4)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: '💋 Mayssa • Bienvenue !' })
    .setTimestamp();

  try { await joinCh.send({ embeds: [joinEmbed] }); } catch {}
});

// ══════════════════════════════════════════════
//  GUILDMEMBERREMOVE — Invite Logger départ
// ══════════════════════════════════════════════
client.on(Events.GuildMemberRemove, async member => {
  const gId = member.guild.id;
  const d = getGuild(gId);
  const il = d.inviteLogger;

  // ── LOG KICK (audit log) ──
  try {
    await new Promise(r => setTimeout(r, 1000));
    const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
    const entry = logs.entries.first();
    if (entry && entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 5000) {
      const logEmbed = new EmbedBuilder()
        .setTitle('👢 Membre Kické')
        .setDescription(`**Membre :** ${member.user.tag}\n**Par :** ${entry.executor?.tag}\n**Raison :** ${entry.reason || 'Non précisée'}`)
        .setColor(0xff8800).setTimestamp();
      await sendLog(member.guild, 'advanced', logEmbed);
      await sendLog(member.guild, 'sanctions', logEmbed);
    }
  } catch {}

  // ── INVITE LOGGER : départ ──
  if (!il.leaveChannelId) return;
  const leaveCh = member.guild.channels.cache.get(il.leaveChannelId);
  if (!leaveCh) return;

  const memberCount = member.guild.memberCount;
  const leaveEmbed = new EmbedBuilder()
    .setTitle('💔 Membre parti')
    .setDescription(
      `**${member.user.username}** vient de quitter le serveur...\n\n` +
      `**👥 Membres restants :** ${memberCount}`
    )
    .setColor(0x555555)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setFooter({ text: '💋 Mayssa • Au revoir 🖤' })
    .setTimestamp();

  try { await leaveCh.send({ embeds: [leaveEmbed] }); } catch {}
});

// ══════════════════════════════════════════════
//  EVENT: INTERACTION
// ══════════════════════════════════════════════
client.on(Events.InteractionCreate, async interaction => {
  const gId = interaction.guildId;
  if (!gId) return;
  const d = getGuild(gId);

  // ── SELECT MENU : ouverture ticket ──
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_open') {
    await interaction.deferReply({ ephemeral: true });
    const selId = interaction.values[0];
    const sel = d.panel.selections.find(s => s.id === selId);
    if (!sel) return interaction.editReply({ content: '❌ Option introuvable.' });

    const existing = Object.entries(d.tickets).find(([, t]) => t.userId === interaction.user.id);
    if (existing) {
      const ch = interaction.guild.channels.cache.get(existing[0]);
      return interaction.editReply({ content: `❌ Tu as déjà un ticket ouvert : ${ch ? ch.toString() : '#ticket-supprimé'}` });
    }

    let parentId = sel.categoryId || null;
    const ticketName = `💋・${selId}-${interaction.user.username}`.slice(0, 100);
    const overwrites = [
      { id: interaction.guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ];
    if (sel.pingRoleId) {
      overwrites.push({ id: sel.pingRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
    // Rôle général autorisé à voir TOUS les tickets (en plus du rôle de la catégorie)
    if (d.ticketViewRoleId) {
      overwrites.push({ id: d.ticketViewRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    let ticketChannel;
    try {
      ticketChannel = await interaction.guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: parentId,
        permissionOverwrites: overwrites,
      });
    } catch (e) {
      return interaction.editReply({ content: '❌ Impossible de créer le ticket. Vérifie les permissions du bot.' });
    }

    d.tickets[ticketChannel.id] = { userId: interaction.user.id, claimedBy: null, selectionId: selId };

    const embed = new EmbedBuilder()
      .setTitle(`💋 Ticket — ${sel.label}`)
      .setDescription(`Bienvenue ${interaction.user} !\n\n*${sel.description}*\n\nUn membre de l'équipe va te répondre bientôt. 💋`)
      .setColor(0x2b0a2b)
      .setFooter({ text: 'Mayssa • Call me Mayssa 💋' })
      .setTimestamp();

    const claimRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_claim').setLabel('✅ Claim').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    );

    let pingMsg = sel.pingRoleId ? `<@&${sel.pingRoleId}>` : '';
    await ticketChannel.send({ content: pingMsg, embeds: [embed], components: [claimRow] });
    await interaction.editReply({ content: `✅ Ton ticket a été ouvert : ${ticketChannel}` });

    const logEmbed = new EmbedBuilder()
      .setTitle('🎫 Nouveau Ticket Ouvert')
      .setDescription(`**Utilisateur :** ${interaction.user} (${interaction.user.id})\n**Raison :** ${sel.label}\n**Salon :** ${ticketChannel}`)
      .setColor(0x00ff99).setTimestamp();
    await sendLog(interaction.guild, 'tickets', logEmbed);
    return;
  }

  // ── BOUTONS TICKET ──
  if (interaction.isButton()) {
    const cId = interaction.customId;

    if (cId === 'ticket_claim' || cId === 'ticket_unclaim') {
      const ticket = d.tickets[interaction.channelId];
      if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
      if (!canClaimTicket(gId, interaction.member, ticket.selectionId)) {
        return interaction.reply({ content: '❌ Tu n\'as pas la permission de claim ce ticket.', ephemeral: true });
      }
      if (cId === 'ticket_claim') {
        ticket.claimedBy = interaction.user.id;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('↩️ Unclaim').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
        );
        await interaction.update({ components: [row] });
        await interaction.channel.send({ content: `✅ **${interaction.user}** a claim ce ticket.` });
      } else {
        ticket.claimedBy = null;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('ticket_claim').setLabel('✅ Claim').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
        );
        await interaction.update({ components: [row] });
        await interaction.channel.send({ content: `↩️ **${interaction.user}** a unclaim ce ticket.` });
      }
      return;
    }

    if (cId === 'ticket_close') {
      const ticket = d.tickets[interaction.channelId];
      if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
      if (!isManager(gId, interaction.member)) {
        return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
      }
      await interaction.reply({ content: '🔒 Fermeture en cours...', ephemeral: true }).catch(() => {});
      await sendCloseCountdown(interaction.channel);
      try {
        const logEmbed = new EmbedBuilder()
          .setTitle('🔒 Ticket Fermé')
          .setDescription(`**Salon :** ${interaction.channel.name}\n**Fermé par :** ${interaction.user}`)
          .setColor(0xff4444).setTimestamp();
        await sendLog(interaction.guild, 'tickets', logEmbed);
        delete d.tickets[interaction.channelId];
        await interaction.channel.delete();
      } catch {}
      return;
    }

    if (cId.startsWith('rule_accept_')) {
      const roleId = cId.replace('rule_accept_', '');
      try {
        await interaction.member.roles.add(roleId);
        await interaction.reply({ content: '✅ Tu as accepté le règlement et obtenu ton rôle !', ephemeral: true });
      } catch {
        await interaction.reply({ content: '❌ Impossible d\'attribuer le rôle.', ephemeral: true });
      }
      return;
    }
  }

  // ── SLASH COMMANDS ──
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  // ════ OWNER ════
  if (commandName === 'addown') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const user = interaction.options.getUser('user');
    if (d.ownerIds.includes(user.id)) return interaction.reply({ content: '⚠️ Déjà owner.', ephemeral: true });
    d.ownerIds.push(user.id);
    return interaction.reply({ content: `✅ ${user} ajouté comme owner bot.`, ephemeral: true });
  }

  if (commandName === 'delown') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const user = interaction.options.getUser('user');
    if (OWNER_IDS_DEFAULT.includes(user.id)) return interaction.reply({ content: '❌ Impossible de retirer un owner par défaut.', ephemeral: true });
    d.ownerIds = d.ownerIds.filter(id => id !== user.id);
    return interaction.reply({ content: `✅ ${user} retiré des owners.`, ephemeral: true });
  }

  if (commandName === 'ownlist') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const list = d.ownerIds.map(id => `<@${id}>`).join('\n') || '*Aucun*';
    const embed = new EmbedBuilder().setTitle('👑 Owners Bot').setDescription(list).setColor(0xffd700);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ════ PANEL ════
  if (commandName === 'paneltitle') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    d.panel.title = interaction.options.getString('titre');
    return interaction.reply({ content: `✅ Titre mis à jour : **${d.panel.title}**`, ephemeral: true });
  }

  if (commandName === 'paneldescription') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    d.panel.description = interaction.options.getString('desc').replace(/\\n/g, '\n');
    return interaction.reply({ content: '✅ Description mise à jour.', ephemeral: true });
  }

  if (commandName === 'panelselection') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const id = interaction.options.getString('id');
    const label = interaction.options.getString('label');
    const desc = interaction.options.getString('description');
    if (d.panel.selections.find(s => s.id === id)) return interaction.reply({ content: '⚠️ ID déjà existant.', ephemeral: true });
    if (d.panel.selections.length >= 25) return interaction.reply({ content: '❌ Maximum 25 options.', ephemeral: true });
    d.panel.selections.push({ id, label, description: desc, pingRoleId: null, categoryId: null });
    return interaction.reply({ content: `✅ Sélection **${label}** ajoutée.`, ephemeral: true });
  }

  if (commandName === 'paneldelselection') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const id = interaction.options.getString('id');
    const before = d.panel.selections.length;
    d.panel.selections = d.panel.selections.filter(s => s.id !== id);
    if (d.panel.selections.length === before) return interaction.reply({ content: '❌ ID introuvable.', ephemeral: true });
    return interaction.reply({ content: `✅ Sélection **${id}** supprimée.`, ephemeral: true });
  }

  if (commandName === 'panelsetpingrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const id = interaction.options.getString('id');
    const role = interaction.options.getRole('role');
    const sel = d.panel.selections.find(s => s.id === id);
    if (!sel) return interaction.reply({ content: '❌ Sélection introuvable.', ephemeral: true });
    sel.pingRoleId = role.id;
    return interaction.reply({ content: `✅ Rôle pingé pour **${id}** : ${role}`, ephemeral: true });
  }

  if (commandName === 'panelsetcategory') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const id = interaction.options.getString('id');
    const cat = interaction.options.getChannel('categorie');
    if (cat.type !== ChannelType.GuildCategory) return interaction.reply({ content: '❌ Ce n\'est pas une catégorie.', ephemeral: true });
    const sel = d.panel.selections.find(s => s.id === id);
    if (!sel) return interaction.reply({ content: '❌ Sélection introuvable.', ephemeral: true });
    sel.categoryId = cat.id;
    return interaction.reply({ content: `✅ Catégorie pour **${id}** : ${cat.name}`, ephemeral: true });
  }

  if (commandName === 'panel') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const { embed, row } = buildPanelComponents(gId);
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Panel envoyé !', ephemeral: true });
  }

  // ════ TICKET ════
  if (commandName === 'add') {
    if (!isManager(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const ticket = d.tickets[interaction.channelId];
    if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
    const user = interaction.options.getUser('user');
    try {
      await interaction.channel.permissionOverwrites.create(user.id, {
        ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
      });
      await interaction.reply({ content: `✅ ${user} ajouté au ticket.` });
    } catch {
      await interaction.reply({ content: '❌ Impossible d\'ajouter cet utilisateur.', ephemeral: true });
    }
    return;
  }

  if (commandName === 'remove') {
    if (!isManager(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const ticket = d.tickets[interaction.channelId];
    if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
    const user = interaction.options.getUser('user');
    if (user.id === ticket.userId) return interaction.reply({ content: '❌ Impossible de retirer le créateur du ticket.', ephemeral: true });
    try {
      await interaction.channel.permissionOverwrites.delete(user.id);
      await interaction.reply({ content: `✅ ${user} retiré du ticket.` });
    } catch {
      await interaction.reply({ content: '❌ Impossible de retirer cet utilisateur.', ephemeral: true });
    }
    return;
  }

  if (commandName === 'close') {
    if (!isManager(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const ticket = d.tickets[interaction.channelId];
    if (!ticket) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
    await interaction.reply({ content: '🔒 Fermeture en cours...', ephemeral: true }).catch(() => {});
    await sendCloseCountdown(interaction.channel);
    try {
      const logEmbed = new EmbedBuilder()
        .setTitle('🔒 Ticket Fermé')
        .setDescription(`**Salon :** ${interaction.channel.name}\n**Fermé par :** ${interaction.user}`)
        .setColor(0xff4444).setTimestamp();
      await sendLog(interaction.guild, 'tickets', logEmbed);
      delete d.tickets[interaction.channelId];
      await interaction.channel.delete();
    } catch {}
    return;
  }

  if (commandName === 'delete') {
    if (!isManager(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    if (!d.tickets[interaction.channelId]) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
    try {
      const logEmbed = new EmbedBuilder()
        .setTitle('🗑️ Ticket Supprimé')
        .setDescription(`**Salon :** ${interaction.channel.name}\n**Supprimé par :** ${interaction.user}`)
        .setColor(0xff0000).setTimestamp();
      await sendLog(interaction.guild, 'tickets', logEmbed);
      delete d.tickets[interaction.channelId];
      await interaction.channel.delete();
    } catch {
      await interaction.reply({ content: '❌ Impossible de supprimer ce salon.', ephemeral: true });
    }
    return;
  }

  if (commandName === 'rename') {
    if (!isManager(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    if (!d.tickets[interaction.channelId]) return interaction.reply({ content: '❌ Ce salon n\'est pas un ticket.', ephemeral: true });
    const nom = interaction.options.getString('nom');
    try {
      await interaction.channel.setName(`💋・${nom}`);
      await interaction.reply({ content: `✅ Ticket renommé en **💋・${nom}**` });
    } catch {
      await interaction.reply({ content: '❌ Impossible de renommer.', ephemeral: true });
    }
    return;
  }

  // ════ SETUP ════
  if (commandName === 'addmanagerole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    if (d.managerRoles.includes(role.id)) return interaction.reply({ content: '⚠️ Déjà manager.', ephemeral: true });
    d.managerRoles.push(role.id);
    return interaction.reply({ content: `✅ ${role} ajouté comme rôle manager.`, ephemeral: true });
  }

  if (commandName === 'removemanagerole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    d.managerRoles = d.managerRoles.filter(id => id !== role.id);
    return interaction.reply({ content: `✅ ${role} retiré des managers.`, ephemeral: true });
  }

  if (commandName === 'listmanageroles') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const list = d.managerRoles.map(id => `<@&${id}>`).join('\n') || '*Aucun*';
    const embed = new EmbedBuilder().setTitle('🔧 Rôles Managers').setDescription(list).setColor(0x5865f2);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'setlogschannel') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const type = interaction.options.getString('type');
    const salon = interaction.options.getChannel('salon');
    const validTypes = ['tickets','antiraid','antispam','antibot','protection','sanctions','advanced','security','boost'];
    if (!validTypes.includes(type)) return interaction.reply({ content: `❌ Type invalide. Valeurs : ${validTypes.join(', ')}`, ephemeral: true });
    d.logsChannels[type] = salon.id;
    return interaction.reply({ content: `✅ Logs **${type}** → ${salon}`, ephemeral: true });
  }

  if (commandName === 'setuplogs') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    try {
      await ensureLogCategory(interaction.guild);
      return interaction.editReply({ content: '✅ Catégorie et salons de logs créés (ou déjà existants détectés).' });
    } catch (e) {
      return interaction.editReply({ content: `❌ Erreur : ${e.message}` });
    }
  }

  // ════ ANTI-RAID ════
  if (commandName === 'antiraid') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const action = interaction.options.getString('action');
    d.antiRaid.enabled = (action === 'on');
    return interaction.reply({ content: `✅ Anti-raid **${action === 'on' ? 'activé' : 'désactivé'}**.`, ephemeral: true });
  }

  if (commandName === 'antilink') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const action = interaction.options.getString('action');
    d.antiLink.enabled = (action === 'on');
    return interaction.reply({ content: `✅ Anti-lien **${action === 'on' ? 'activé' : 'désactivé'}**.`, ephemeral: true });
  }

  if (commandName === 'setbypassrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    if (!d.antiLink.fullBypassRoles.includes(role.id)) d.antiLink.fullBypassRoles.push(role.id);
    return interaction.reply({ content: `✅ ${role} peut envoyer tous les liens.`, ephemeral: true });
  }

  if (commandName === 'setgifonlyrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    if (!d.antiLink.gifOnlyBypassRoles.includes(role.id)) d.antiLink.gifOnlyBypassRoles.push(role.id);
    return interaction.reply({ content: `✅ ${role} peut envoyer des GIFs uniquement.`, ephemeral: true });
  }

  if (commandName === 'lockdown') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const action = interaction.options.getString('action');
    await interaction.deferReply({ ephemeral: true });
    d.lockdown = (action === 'on');
    try {
      const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
      for (const [, ch] of channels) {
        try {
          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            SendMessages: action === 'on' ? false : null,
          });
        } catch {}
      }
      const logEmbed = new EmbedBuilder()
        .setTitle(action === 'on' ? '🔴 LOCKDOWN ACTIVÉ' : '🟢 LOCKDOWN DÉSACTIVÉ')
        .setDescription(`**Par :** ${interaction.user}`)
        .setColor(action === 'on' ? 0xff0000 : 0x00ff00).setTimestamp();
      await sendLog(interaction.guild, 'security', logEmbed);
      return interaction.editReply({ content: `✅ Lockdown **${action === 'on' ? 'activé' : 'désactivé'}**.` });
    } catch (e) {
      return interaction.editReply({ content: `❌ Erreur : ${e.message}` });
    }
  }

  if (commandName === 'maintenance') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const action = interaction.options.getString('action');
    d.maintenance = (action === 'on');
    client.user.setPresence({
      activities: [{ name: action === 'on' ? '🔧 Maintenance...' : '💋 Mayssa • Call me Mayssa' }],
      status: action === 'on' ? 'idle' : 'dnd',
    });
    return interaction.reply({ content: `✅ Mode maintenance **${action === 'on' ? 'activé' : 'désactivé'}**.`, ephemeral: true });
  }

  if (commandName === 'whitelist') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const action = interaction.options.getString('action');
    const user = interaction.options.getUser('user');
    if (action === 'add') {
      if (!user) return interaction.reply({ content: '❌ Précise un utilisateur.', ephemeral: true });
      if (!d.whitelist.includes(user.id)) d.whitelist.push(user.id);
      return interaction.reply({ content: `✅ ${user} ajouté à la whitelist.`, ephemeral: true });
    } else if (action === 'remove') {
      if (!user) return interaction.reply({ content: '❌ Précise un utilisateur.', ephemeral: true });
      d.whitelist = d.whitelist.filter(id => id !== user.id);
      return interaction.reply({ content: `✅ ${user} retiré de la whitelist.`, ephemeral: true });
    } else {
      const list = d.whitelist.map(id => `<@${id}>`).join('\n') || '*Vide*';
      const embed = new EmbedBuilder().setTitle('🛡️ Whitelist Admin').setDescription(list).setColor(0x00ff99);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ════ RÈGLEMENT ════
  if (commandName === 'rule') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const message = interaction.options.getString('message').replace(/\\n/g, '\n');
    const role = interaction.options.getRole('role');
    const embed = new EmbedBuilder()
      .setTitle('📜 Règlement — Mayssa')
      .setDescription(message)
      .setColor(0x2b0a2b)
      .setFooter({ text: 'Clique sur le bouton ci-dessous pour valider et obtenir l\'accès 💋' })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rule_accept_${role.id}`)
        .setLabel('✅ J\'accepte le règlement')
        .setStyle(ButtonStyle.Success)
    );
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: `✅ Règlement envoyé. Le rôle ${role} sera attribué après validation.`, ephemeral: true });
  }

  // ════ ROLEMEMBER ════
  if (commandName === 'rolemember') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');

    // Sauvegarder pour les nouveaux arrivants
    d.autoRoleId = role.id;

    await interaction.deferReply({ ephemeral: true });

    // Donner le rôle à tous les membres existants
    let success = 0;
    let fail = 0;
    try {
      const members = await interaction.guild.members.fetch();
      for (const [, member] of members) {
        if (member.user.bot) continue;
        if (member.roles.cache.has(role.id)) continue;
        try {
          await member.roles.add(role.id);
          success++;
          // Petite pause pour éviter le rate-limit Discord
          if (success % 10 === 0) await new Promise(r => setTimeout(r, 1000));
        } catch { fail++; }
      }
    } catch (e) {
      return interaction.editReply({ content: `❌ Erreur lors du fetch des membres : ${e.message}` });
    }

    return interaction.editReply({
      content: `✅ Rôle ${role} attribué à **${success}** membre(s).\n${fail > 0 ? `⚠️ Échec pour **${fail}** membre(s).\n` : ''}💋 Ce rôle sera aussi donné automatiquement aux nouveaux arrivants.`,
    });
  }

  // ════ SAY ════
  if (commandName === 'say') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });

    const salon = interaction.options.getChannel('salon');
    const messageText = interaction.options.getString('message').replace(/\\n/g, '\n');
    const style = interaction.options.getString('style');
    const titre = interaction.options.getString('titre') || null;
    const couleurHex = interaction.options.getString('couleur') || null;

    // Vérif que le salon est un text channel
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(salon.type)) {
      return interaction.reply({ content: '❌ Le salon doit être un salon textuel.', ephemeral: true });
    }

    // Parser la couleur
    let color = 0xff69b4; // rose NSFW par défaut
    if (couleurHex) {
      const parsed = parseInt(couleurHex.replace('#', ''), 16);
      if (!isNaN(parsed)) color = parsed;
    }

    try {
      if (style === 'embed') {
        const embed = new EmbedBuilder()
          .setDescription(messageText)
          .setColor(color)
          .setFooter({ text: '💋 Mayssa' })
          .setTimestamp();
        if (titre) embed.setTitle(titre);

        await salon.send({ embeds: [embed] });
      } else {
        await salon.send({ content: messageText });
      }
      return interaction.reply({ content: `✅ Message envoyé dans ${salon} !`, ephemeral: true });
    } catch (e) {
      return interaction.reply({ content: `❌ Impossible d'envoyer dans ce salon : ${e.message}`, ephemeral: true });
    }
  }

  // ════ INVITE LOGGER ════
  if (commandName === 'invitelogger') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const action = interaction.options.getString('action');
    const salon = interaction.options.getChannel('salon');
    const il = d.inviteLogger;

    if (action === 'setjoin') {
      if (!salon) return interaction.reply({ content: '❌ Précise un salon.', ephemeral: true });
      il.joinChannelId = salon.id;
      return interaction.reply({ content: `✅ Salon d'arrivée défini : ${salon} 💋`, ephemeral: true });
    }

    if (action === 'setleave') {
      if (!salon) return interaction.reply({ content: '❌ Précise un salon.', ephemeral: true });
      il.leaveChannelId = salon.id;
      return interaction.reply({ content: `✅ Salon de départ défini : ${salon} 🖤`, ephemeral: true });
    }

    if (action === 'enable') {
      await interaction.deferReply({ ephemeral: true });
      try {
        await cacheInvites(interaction.guild);
        return interaction.editReply({ content: `✅ Cache d'invites rechargé ! **${Object.keys(il.inviteCache).length}** invite(s) en mémoire.` });
      } catch (e) {
        return interaction.editReply({ content: `❌ Erreur : ${e.message}` });
      }
    }

    if (action === 'status') {
      const joinCh = il.joinChannelId ? `<#${il.joinChannelId}>` : '`Non défini`';
      const leaveCh = il.leaveChannelId ? `<#${il.leaveChannelId}>` : '`Non défini`';
      const cacheSize = Object.keys(il.inviteCache).length;
      const embed = new EmbedBuilder()
        .setTitle('💋 Invite Logger — Config')
        .setDescription(
          `**Salon arrivées :** ${joinCh}\n` +
          `**Salon départs :** ${leaveCh}\n` +
          `**Invites en cache :** ${cacheSize}`
        )
        .setColor(0xff69b4)
        .setFooter({ text: 'Mayssa • Call me Mayssa 💋' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  // ════ RÔLES SPÉCIAUX ════
  if (commandName === 'setblrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    d.blRoleId = role.id;
    return interaction.reply({ content: `✅ Rôle autorisé pour &bl : ${role}`, ephemeral: true });
  }

  if (commandName === 'setdogrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    d.dogRoleId = role.id;
    return interaction.reply({ content: `✅ Rôle autorisé pour /dog : ${role}`, ephemeral: true });
  }

  if (commandName === 'setdmrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    d.dmRoleId = role.id;
    return interaction.reply({ content: `✅ Rôle autorisé pour /dm : ${role}`, ephemeral: true });
  }

  if (commandName === 'setticketrole') {
    if (!isOwner(gId, interaction.user.id)) return interaction.reply({ content: '❌ Owner bot uniquement.', ephemeral: true });
    const role = interaction.options.getRole('role');
    d.ticketViewRoleId = role.id;
    return interaction.reply({ content: `✅ Rôle pouvant voir TOUS les tickets : ${role}`, ephemeral: true });
  }

  // ════ DOG (laisse) ════
  if (commandName === 'dog') {
    if (!canUseDog(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    if (isOwner(gId, targetUser.id)) return interaction.reply({ content: '❌ Impossible de mettre en laisse un Sys+ (ownerbot).', ephemeral: true });
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) return interaction.reply({ content: '❌ Membre introuvable sur ce serveur.', ephemeral: true });

    d.dogged[targetUser.id] = { masterId: interaction.user.id, originalNick: targetMember.nickname };

    const newNick = `${targetMember.displayName}(🦮 de ${interaction.member.displayName})`.slice(0, 32);
    try { await targetMember.setNickname(newNick); } catch {}

    // Suivi immédiat si le maître et le chien sont déjà en vocal
    if (interaction.member.voice.channelId && targetMember.voice.channelId) {
      try { await targetMember.voice.setChannel(interaction.member.voice.channelId); } catch {}
    }

    return interaction.reply({ content: `🦮 ${targetMember} est maintenant en laisse, sous le contrôle de ${interaction.member}.` });
  }

  if (commandName === 'undog') {
    if (!canUseDog(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    if (!d.dogged[targetUser.id]) return interaction.reply({ content: '❌ Ce membre n\'est pas en laisse.', ephemeral: true });
    const info = d.dogged[targetUser.id];
    delete d.dogged[targetUser.id];
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (targetMember) { try { await targetMember.setNickname(info.originalNick || null); } catch {} }
    return interaction.reply({ content: `✅ ${targetUser} n'est plus en laisse.` });
  }

  if (commandName === 'undogalls') {
    if (!canUseDog(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const entries = Object.entries(d.dogged);
    for (const [targetId, info] of entries) {
      const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (targetMember) { try { await targetMember.setNickname(info.originalNick || null); } catch {} }
    }
    d.dogged = {};
    return interaction.editReply({ content: `✅ **${entries.length}** membre(s) libéré(s) de leur laisse.` });
  }

  if (commandName === 'undoglist') {
    if (!canUseDog(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const entries = Object.entries(d.dogged);
    const list = entries.length
      ? entries.map(([id, info]) => `• <@${id}> 🦮 → maître : <@${info.masterId}>`).join('\n')
      : '*Aucun membre en laisse.*';
    const embed = new EmbedBuilder().setTitle('🦮 Liste des chiens').setDescription(list).setColor(0xff69b4);
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ════ DM ════
  if (commandName === 'dm') {
    if (!canUseDm(gId, interaction.member)) return interaction.reply({ content: '❌ Permission insuffisante.', ephemeral: true });
    const targetUser = interaction.options.getUser('user');
    const msgText = interaction.options.getString('message');
    const identite = interaction.options.getString('identite');

    let content = msgText;
    if (identite === 'afficher') {
      content = `**Message de ${interaction.user.tag} :**\n${msgText}`;
    }

    try {
      await targetUser.send({ content });
      return interaction.reply({ content: `✅ Message envoyé à ${targetUser}.`, ephemeral: true });
    } catch {
      return interaction.reply({ content: `❌ Impossible d'envoyer un DM à ${targetUser} (MP fermés ?).`, ephemeral: true });
    }
  }
});

// ══════════════════════════════════════════════
//  BLACKLIST + LOCKNAME — Commandes texte (préfixes & et ,)
// ══════════════════════════════════════════════

// ── &bl @user/ID [raison] ──
async function cmdBl(message, d, gId, member, args) {
  const id = extractIdFromArg(args[0]);
  if (!id) return message.reply({ content: 'Veuillez fournir l\'ID/@user.' });

  if (isOwner(gId, id)) {
    return message.reply({ content: '❌ Impossible de blacklister un Sys+.' });
  }

  if (d.blacklist[id]) {
    return message.reply({ content: '⚠️ Ce membre est déjà blacklisté.' });
  }

  // Hiérarchie — ne s'applique pas aux Sys+ (ownerbot)
  if (!isOwner(gId, member.id)) {
    const targetMemberCheck = await message.guild.members.fetch(id).catch(() => null);
    if (targetMemberCheck && targetMemberCheck.roles.highest.position >= member.roles.highest.position) {
      return message.reply({ content: '❌ Tu ne peux pas blacklister un membre avec un rôle égal ou supérieur au tien.' });
    }
  }

  let target;
  try { target = await client.users.fetch(id); } catch { return message.reply({ content: '❌ Utilisateur introuvable.' }); }

  const reason = args.slice(1).join(' ') || null;

  // DM envoyé AVANT le traitement de la blacklist
  try {
    await target.send({ content: `Tu as été blacklisté de **${message.guild.name}** raison: ${reason || ''}` });
  } catch {}

  d.blacklist[id] = {
    reason,
    byId: member.id,
    byTag: member.user.tag,
    bySysPlus: isOwner(gId, member.id),
    timestamp: Date.now(),
  };

  try { await message.guild.members.ban(id, { reason: reason || 'Blacklist' }); } catch {}

  return message.reply({ content: `✅ <@${id}> a été blacklisté${reason ? ` pour : ${reason}` : ''}.` });
}

// ── &unbl @user/ID ──
async function cmdUnbl(message, d, gId, member, args) {
  const id = extractIdFromArg(args[0]);
  if (!id) return message.reply({ content: 'Veuillez fournir l\'ID/@user.' });
  if (!d.blacklist[id]) return message.reply({ content: '❌ Ce membre n\'est pas blacklisté.' });

  delete d.blacklist[id];
  try { await message.guild.members.unban(id); } catch {}

  return message.reply({ content: `✅ <@${id}> n'est plus blacklisté.` });
}

// ── &blist ──
async function cmdBlist(message, d, gId) {
  const entries = Object.entries(d.blacklist);
  const list = entries.length
    ? entries.map(([id, info]) => `• <@${id}> (${id}) — ${info.bySysPlus ? '🔒 raison cachée (Sys+)' : (info.reason || 'Aucune raison')}`).join('\n')
    : '*Aucun utilisateur blacklisté.*';
  const embed = new EmbedBuilder().setTitle('📋 Liste des blacklists').setDescription(list).setColor(0x2b0a2b);
  return message.reply({ embeds: [embed] });
}

// ── &unblalls ──
async function cmdUnblalls(message, d, gId) {
  const ids = Object.keys(d.blacklist);
  for (const id of ids) {
    try { await message.guild.members.unban(id); } catch {}
  }
  d.blacklist = {};
  return message.reply({ content: `✅ **${ids.length}** membre(s) retiré(s) de la blacklist.` });
}

// ── &blinfo @user/ID ──
async function cmdBlinfo(message, d, gId, member, args) {
  const id = extractIdFromArg(args[0]);
  if (!id) return message.reply({ content: 'Veuillez fournir l\'ID/@user.' });
  const info = d.blacklist[id];
  if (!info) return message.reply({ content: '❌ Ce membre n\'est pas blacklisté.' });

  const dateStr = new Date(info.timestamp).toLocaleString('fr-FR');
  const motifLine = info.bySysPlus ? '🔒 Caché (Sys+)' : (info.reason || '*Aucune*');
  const modLine = info.bySysPlus ? '❌ Par Sys+' : `<@${info.byId}>`;
  const modIdLine = info.bySysPlus ? '*Caché*' : info.byId;

  const desc =
    '╭───────────────\n' +
    '│ 📄 Rapport BL INFO\n' +
    '╰───────────────\n\n' +
    '👤 Utilisateur\n' +
    `• Pseudo : <@${id}>\n` +
    `• Identifiant : ${id}\n\n` +
    '📝 Motif :\n' +
    `${motifLine}\n\n` +
    '👮 Traitement\n' +
    `• Modérateur : ${modLine}\n` +
    `• Identifiant : ${modIdLine}\n\n` +
    '📅 Date\n' +
    ` • ${dateStr}`;

  const embed = new EmbedBuilder().setDescription(desc).setColor(0x2b0a2b);
  return message.reply({ embeds: [embed] });
}

// ── ,lockname @user/ID NomVoulu ──
async function cmdLockname(message, d, gId, member, args) {
  const id = extractIdFromArg(args[0]);
  if (!id) return message.reply({ content: 'Veuillez fournir l\'ID/@user.' });
  const newName = args.slice(1).join(' ').slice(0, 32);
  if (!newName) return message.reply({ content: '❌ Précise le nom à verrouiller. Exemple : ,lockname @user NomVoulu' });

  const targetMember = await message.guild.members.fetch(id).catch(() => null);
  if (!targetMember) return message.reply({ content: '❌ Membre introuvable sur ce serveur.' });

  d.lockedNames[id] = newName;
  try { await targetMember.setNickname(newName); } catch {}

  return message.reply({ content: `✅ Le pseudo de ${targetMember} est désormais verrouillé sur **${newName}**.` });
}

// ── ,unlockname @user/ID ──
async function cmdUnlockname(message, d, args) {
  const id = extractIdFromArg(args[0]);
  if (!id) return message.reply({ content: 'Veuillez fournir l\'ID/@user.' });
  if (!d.lockedNames[id]) return message.reply({ content: '❌ Ce membre n\'a pas de pseudo verrouillé.' });
  delete d.lockedNames[id];
  return message.reply({ content: `✅ Le pseudo de <@${id}> n'est plus verrouillé.` });
}

// ── ,unlocknamealls ──
async function cmdUnlocknamealls(message, d) {
  const count = Object.keys(d.lockedNames).length;
  d.lockedNames = {};
  return message.reply({ content: `✅ **${count}** pseudo(s) déverrouillé(s).` });
}

// ── ,locknamelist ──
async function cmdLocknamelist(message, d) {
  const entries = Object.entries(d.lockedNames);
  const list = entries.length
    ? entries.map(([id, name]) => `• <@${id}> → **${name}**`).join('\n')
    : '*Aucun pseudo verrouillé.*';
  const embed = new EmbedBuilder().setTitle('🔒 Pseudos verrouillés').setDescription(list).setColor(0x5865f2);
  return message.reply({ embeds: [embed] });
}

// ── Dispatcher commandes & ──
async function handleBlCommands(message, d, gId, member) {
  const args = message.content.trim().split(/\s+/);
  const cmd = args[0].slice(1).toLowerCase();
  const validCommands = ['bl', 'unbl', 'blist', 'unblalls', 'blinfo'];
  if (!validCommands.includes(cmd)) return false;

  if (!canUseBl(gId, member)) {
    await message.reply({ content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.' });
    return true;
  }

  if (cmd === 'bl') await cmdBl(message, d, gId, member, args.slice(1));
  else if (cmd === 'unbl') await cmdUnbl(message, d, gId, member, args.slice(1));
  else if (cmd === 'blist') await cmdBlist(message, d, gId);
  else if (cmd === 'unblalls') await cmdUnblalls(message, d, gId);
  else if (cmd === 'blinfo') await cmdBlinfo(message, d, gId, member, args.slice(1));
  return true;
}

// ── Dispatcher commandes , ──
async function handleLockCommands(message, d, gId, member) {
  const args = message.content.trim().split(/\s+/);
  const cmd = args[0].slice(1).toLowerCase();
  const validCommands = ['lockname', 'unlockname', 'unlocknamealls', 'locknamelist'];
  if (!validCommands.includes(cmd)) return false;

  if (!isOwner(gId, member.id)) {
    await message.reply({ content: '❌ Owner bot uniquement.' });
    return true;
  }

  if (cmd === 'lockname') await cmdLockname(message, d, gId, member, args.slice(1));
  else if (cmd === 'unlockname') await cmdUnlockname(message, d, args.slice(1));
  else if (cmd === 'unlocknamealls') await cmdUnlocknamealls(message, d);
  else if (cmd === 'locknamelist') await cmdLocknamelist(message, d);
  return true;
}

// ══════════════════════════════════════════════
//  ANTI-LIEN + ANTI-SPAM — MessageCreate
// ══════════════════════════════════════════════
const LINK_REGEX = /https?:\/\/[^\s]+|discord\.gg\/[^\s]+|discord\.com\/invite\/[^\s]+/gi;
const GIF_ONLY_ALLOWED = /tenor\.com|giphy\.com|media\.discordapp\.net.*\.gif|cdn\.discordapp\.com.*\.gif/i;
const SPAM_THRESHOLD = 5;
const SPAM_WINDOW    = 4000;

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;
  const gId = message.guild.id;
  const d = getGuild(gId);
  const member = message.member;
  if (!member) return;

  // ── COMMANDES TEXTE & (BLACKLIST) ──
  if (message.content.startsWith('&')) {
    const handled = await handleBlCommands(message, d, gId, member);
    if (handled) return;
  }

  // ── COMMANDES TEXTE , (LOCKNAME) ──
  if (message.content.startsWith(',')) {
    const handled = await handleLockCommands(message, d, gId, member);
    if (handled) return;
  }

  const uid = message.author.id;
  const now = Date.now();
  if (!d.antiSpam.userMessages[uid]) d.antiSpam.userMessages[uid] = [];
  d.antiSpam.userMessages[uid] = d.antiSpam.userMessages[uid].filter(t => now - t < SPAM_WINDOW);
  d.antiSpam.userMessages[uid].push(now);

  if (d.antiSpam.userMessages[uid].length >= SPAM_THRESHOLD) {
    if (!d.whitelist.includes(uid) && !isOwner(gId, uid)) {
      try {
        const msgs = await message.channel.messages.fetch({ limit: 10 });
        const toDelete = msgs.filter(m => m.author.id === uid);
        await message.channel.bulkDelete(toDelete, true);
        await member.timeout(60000, 'Anti-spam : messages trop rapides');
        const logEmbed = new EmbedBuilder()
          .setTitle('🚫 Anti-Spam Déclenché')
          .setDescription(`**Utilisateur :** ${message.author} (${uid})\n**Salon :** ${message.channel}\n**Action :** Timeout 1 minute`)
          .setColor(0xff8800).setTimestamp();
        await sendLog(message.guild, 'antispam', logEmbed);
        d.antiSpam.userMessages[uid] = [];
      } catch {}
      return;
    }
  }

  const mentionCount = (message.content.match(/<@[!&]?\d+>/g) || []).length;
  const hasMassMention = message.mentions.everyone || mentionCount >= 5;
  if (hasMassMention && !d.whitelist.includes(uid) && !isOwner(gId, uid)) {
    try {
      await message.delete();
      await member.timeout(300000, 'Anti-mention massive');
      const logEmbed = new EmbedBuilder()
        .setTitle('🚫 Mention Massive Détectée')
        .setDescription(`**Utilisateur :** ${message.author}\n**Salon :** ${message.channel}`)
        .setColor(0xff0000).setTimestamp();
      await sendLog(message.guild, 'antispam', logEmbed);
    } catch {}
    return;
  }

  if (d.antiLink.enabled && LINK_REGEX.test(message.content)) {
    LINK_REGEX.lastIndex = 0;
    const hasFullBypass = d.antiLink.fullBypassRoles.some(rId => member.roles.cache.has(rId));
    if (hasFullBypass) return;

    const hasGifBypass = d.antiLink.gifOnlyBypassRoles.some(rId => member.roles.cache.has(rId));
    if (hasGifBypass) {
      const links = message.content.match(LINK_REGEX) || [];
      const allGifsOk = links.every(l => GIF_ONLY_ALLOWED.test(l));
      if (allGifsOk) return;
    }

    if (!d.whitelist.includes(uid) && !isOwner(gId, uid)) {
      try {
        await message.delete();
        await member.timeout(60000, 'Anti-lien : envoi de lien non autorisé');
        const warn = await message.channel.send({
          content: `${message.author} ❌ Tu n'as pas la permission d'envoyer des liens. **Timeout 1 minute.**`,
        });
        setTimeout(() => warn.delete().catch(() => {}), 8000);
        const logEmbed = new EmbedBuilder()
          .setTitle('🔗 Lien Supprimé')
          .setDescription(`**Utilisateur :** ${message.author}\n**Salon :** ${message.channel}\n**Contenu :** ${message.content.slice(0, 200)}`)
          .setColor(0xff6600).setTimestamp();
        await sendLog(message.guild, 'antiraid', logEmbed);
      } catch {}
    }
  }
});

// ══════════════════════════════════════════════
//  PROTECTION SERVEUR — Audit Log + Backups
//  (les salons ticket 💋・ sont exclus pour ne pas être recréés à la fermeture)
// ══════════════════════════════════════════════
function backupChannels(guild) {
  const d = getGuild(guild.id);
  d.channelBackup = {};
  for (const [id, ch] of guild.channels.cache) {
    if (ch.name && ch.name.startsWith('💋・')) continue; // tickets exclus
    if (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildVoice) {
      d.channelBackup[id] = {
        name: ch.name,
        type: ch.type,
        parentId: ch.parentId,
        position: ch.position,
      };
    }
  }
}

client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;
  if (channel.name && channel.name.startsWith('💋・')) return; // ne jamais restaurer un ticket fermé
  const gId = channel.guild.id;
  const d = getGuild(gId);
  const backup = d.channelBackup[channel.id];
  if (!backup) return;

  let deletedBy = null;
  try {
    await new Promise(r => setTimeout(r, 1000));
    const logs = await channel.guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 1 });
    const entry = logs.entries.first();
    if (entry && Date.now() - entry.createdTimestamp < 5000) {
      deletedBy = entry.executor;
    }
  } catch {}

  const logEmbed = new EmbedBuilder()
    .setTitle('🔨 Salon Supprimé')
    .setDescription(`**Salon :** ${backup.name}\n**Par :** ${deletedBy ? deletedBy.tag : 'Inconnu'}`)
    .setColor(0xff4444).setTimestamp();
  await sendLog(channel.guild, 'protection', logEmbed);

  if (deletedBy && !d.whitelist.includes(deletedBy.id) && !isOwner(gId, deletedBy.id)) {
    try {
      await channel.guild.channels.create({
        name: backup.name,
        type: backup.type,
        parent: backup.parentId,
        position: backup.position,
      });
      const restoreEmbed = new EmbedBuilder()
        .setTitle('✅ Salon Restauré')
        .setDescription(`**Salon :** ${backup.name} a été restauré automatiquement.`)
        .setColor(0x00ff99).setTimestamp();
      await sendLog(channel.guild, 'protection', restoreEmbed);
    } catch {}
  }

  delete d.channelBackup[channel.id];
});

client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;
  if (channel.name && channel.name.startsWith('💋・')) return; // pas de backup pour les tickets
  const d = getGuild(channel.guild.id);

  const now = Date.now();
  if (!d._channelCreateTimestamps) d._channelCreateTimestamps = [];
  d._channelCreateTimestamps = d._channelCreateTimestamps.filter(t => now - t < 10000);
  d._channelCreateTimestamps.push(now);

  if (d._channelCreateTimestamps.length >= 5) {
    const logEmbed = new EmbedBuilder()
      .setTitle('⚠️ Création Massive de Salons')
      .setDescription(`**${d._channelCreateTimestamps.length}** salons créés en 10 secondes !`)
      .setColor(0xff8800).setTimestamp();
    await sendLog(channel.guild, 'protection', logEmbed);
  }

  d.channelBackup[channel.id] = {
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId,
    position: channel.position,
  };
});

// ══════════════════════════════════════════════
//  LOGS AVANCÉS + BOOST SERVEUR + LOCKNAME
// ══════════════════════════════════════════════

// Phrases courtes, "humaines", style Mayssa — piochées au hasard pour ne pas être robotique
const BOOST_THANKS = [
  "merci pour le boost bébé, tu sais déjà comment me faire plaisir 💋",
  "mmh, un boost de toi... tu mérites une attention spéciale 😘",
  "boost reçu 💋 t'es officiellement dans mes favoris maintenant",
  "merci mon cœur, ce genre de geste ne s'oublie pas 💋",
  "tu viens de monter dans mon classement perso... merci bébé 😏",
  "un boost de plus, une raison de plus de penser à toi 💋",
  "ohh toi 👀 merci pour le boost, t'es adorable",
];

const BOOST_BYE = [
  "tu m'as quittée... le boost est parti 🖤",
  "le boost s'en va, mais je garde un œil sur toi 👀",
  "bon... on dirait que tu m'as un peu oubliée 🖤",
  "le boost a disparu, mais la porte reste ouverte 💋",
  "ça pique un peu, mais je comprends, à bientôt peut-être 🖤",
];

client.on(Events.GuildBanAdd, async ban => {
  const logEmbed = new EmbedBuilder()
    .setTitle('🔨 Membre Banni')
    .setDescription(`**Membre :** ${ban.user.tag} (${ban.user.id})\n**Raison :** ${ban.reason || 'Non précisée'}`)
    .setColor(0xff0000).setTimestamp();
  await sendLog(ban.guild, 'advanced', logEmbed);
  await sendLog(ban.guild, 'sanctions', logEmbed);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const logEmbed = new EmbedBuilder()
    .setTitle('✏️ Rôle Modifié')
    .setDescription(`**Rôle :** ${newRole.name}\n**Modifications :** permissions ou couleur changées`)
    .setColor(0x5865f2).setTimestamp();
  await sendLog(newRole.guild, 'advanced', logEmbed);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const gId = newMember.guild.id;
  const d = getGuild(gId);

  // ── TIMEOUT (mute) ──
  const wasTimedOut = !oldMember.communicationDisabledUntil && newMember.communicationDisabledUntil;
  if (wasTimedOut) {
    const logEmbed = new EmbedBuilder()
      .setTitle('🔇 Membre Timeout (Mute)')
      .setDescription(`**Membre :** ${newMember.user.tag}\n**Jusqu\'au :** ${newMember.communicationDisabledUntil.toLocaleString('fr-FR')}`)
      .setColor(0xffaa00).setTimestamp();
    await sendLog(newMember.guild, 'sanctions', logEmbed);
  }

  // ── BOOST SERVEUR ──
  const startedBoosting = !oldMember.premiumSinceTimestamp && newMember.premiumSinceTimestamp;
  const stoppedBoosting = oldMember.premiumSinceTimestamp && !newMember.premiumSinceTimestamp;

  if ((startedBoosting || stoppedBoosting) && d.logsChannels.boost) {
    const ch = newMember.guild.channels.cache.get(d.logsChannels.boost);
    if (ch) {
      const phrase = startedBoosting
        ? BOOST_THANKS[Math.floor(Math.random() * BOOST_THANKS.length)]
        : BOOST_BYE[Math.floor(Math.random() * BOOST_BYE.length)];
      try { await ch.send({ content: `${newMember} ${phrase}` }); } catch {}
    }
  }

  // ── LOCKNAME — anti-changement de pseudo (remise instantanée) ──
  const lockedName = d.lockedNames[newMember.id];
  if (lockedName && newMember.nickname !== lockedName) {
    try { await newMember.setNickname(lockedName); } catch {}
  }
});

// ══════════════════════════════════════════════
//  DOG (LAISSE) — Suivi vocal automatique du maître
// ══════════════════════════════════════════════
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const gId = newState.guild.id;
  const d = getGuild(gId);
  const movedMemberId = newState.member.id;

  // Cas 1 : le membre qui bouge est un MAÎTRE → faire suivre ses chiens
  if (newState.channelId !== oldState.channelId) {
    for (const [targetId, info] of Object.entries(d.dogged)) {
      if (info.masterId === movedMemberId) {
        const dogMember = await newState.guild.members.fetch(targetId).catch(() => null);
        if (dogMember && dogMember.voice.channelId) {
          if (newState.channelId) {
            try { await dogMember.voice.setChannel(newState.channelId); } catch {}
          } else {
            try { await dogMember.voice.disconnect(); } catch {}
          }
        }
      }
    }
  }

  // Cas 2 : le membre qui bouge est un CHIEN qui s'éloigne de son maître → on le ramène
  const dogInfo = d.dogged[movedMemberId];
  if (dogInfo && newState.channelId) {
    const masterMember = await newState.guild.members.fetch(dogInfo.masterId).catch(() => null);
    const masterChannelId = masterMember?.voice?.channelId || null;
    if (masterChannelId && newState.channelId !== masterChannelId) {
      try { await newState.member.voice.setChannel(masterChannelId); } catch {}
    }
  }
});

// ══════════════════════════════════════════════
//  EXPRESS KEEPALIVE
// ══════════════════════════════════════════════
const app = express();

app.get('/', (req, res) => {
  res.send('🌸 Mayssa Bot — En ligne 💋');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', guilds: client.guilds.cache.size, uptime: process.uptime() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Serveur keepalive sur le port ${PORT}`);
});

const PING_URL = RENDER_URL || 'https://nsfw-bot-p9u8.onrender.com';
setInterval(async () => {
  try {
    await fetch(`${PING_URL}/health`);
    console.log('💓 Self-ping OK →', PING_URL);
  } catch (e) {
    console.warn('⚠️ Self-ping failed:', e.message);
  }
}, 2 * 60 * 1000);

// ══════════════════════════════════════════════
//  LOGIN
// ══════════════════════════════════════════════
client.login(TOKEN)