import * as dotenv from 'dotenv'
dotenv.config()

import { Rcon } from 'rcon-client'
import { App, MessageEmbed, User } from 'dxn'
import Keyv from 'keyv'

type UserData = {
  discordId: string
  minecraftUsername: string
  emojiId?: string
  emojiUpdated: boolean
  totalPlay: number
}

type ActivityMonitor = {
  playerListChannel?: string
  playerListMessage?: string
}

const getHeadEmoji = (user: User) => `${user.username}_head`

const keyv = new Keyv(`sqlite://${process.env.DB}`)

const getGuild = async (): Promise<string | void> => {
  return keyv.get('guild')
}

const setGuild = async (id: string) => {
  await keyv.set('guild', id)
}

const getUsers = async (): Promise<UserData[]> => {
  const users = await keyv.get('users')

  if (!users) {
    await setUsers([])
  }

  return users || []
}

const setUsers = async (users: UserData[]) => {
  return keyv.set('users', users)
}

const getActivityMonitor = async (): Promise<ActivityMonitor> => {
  const monitor = await keyv.get('activity_monitor')

  if (!monitor) {
    await setActivityMonitor({})
  }

  return monitor || {}
}

const setActivityMonitor = async (monitor: ActivityMonitor) => {
  return keyv.set('activity_monitor', monitor)
}

const main = async () => {
  const rcon = await Rcon.connect({
    host: process.env.RCON_HOST as string,
    password: process.env.RCON_PASS as string,
  })
  const app = new App({
    prefixes: ['::'],
  })

  const removeWhitelist = async (username: string) => {
    await rcon.send(`/whitelist remove ${username}`)
    await rcon.send('/whitelist reload')
  }

  const addWhitelist = async (username: string): Promise<boolean> => {
    const res = await rcon.send(`/whitelist add ${username}`)
    await rcon.send('/whitelist reload')

    return !res.includes('does not exist')
  }

  const listOnline = async (): Promise<string[]> => {
    const res = await rcon.send('/list')
    const matches = res.match(/online: (.*)/)

    if (matches && matches[1]) {
      return matches[1].split(', ')
    }

    return []
  }

  const countOnline = async (): Promise<number> => {
    const res = await rcon.send('/list')
    const matches = res.match(/There are (\d+)/)

    if (matches) {
      return parseInt(matches[1])
    }

    return 0
  }

  app.command('join {username: string}', async (message, { args }) => {
    const users = await getUsers()
    const exists = users.find(
      (u) =>
        u.minecraftUsername === args.username &&
        u.discordId !== message.author.id
    )

    if (exists) {
      const user = await app.client.users.fetch(exists.discordId)
      message.reply(`そのユーザーは既に ${user.username} と紐付けられてるよ。`)
      return
    }

    const user = users.find((u) => u.discordId === message.author.id)

    if (user?.minecraftUsername === args.username) {
      message.reply(`そのユーザーは既に君に紐付けられてるよ。`)
      return
    }

    const result = await addWhitelist(args.username)

    if (result) {
      if (user) {
        await removeWhitelist(user.minecraftUsername)

        message.reply(
          `君をマイクラユーザー \`${args.username}\` に紐づけたよ。\n前に紐付けられていた \`${user.minecraftUsername}\` はもう使えないから気をつけてね。`
        )
        user.minecraftUsername = args.username
        user.emojiUpdated = false
      } else {
        users.push({
          discordId: message.author.id,
          minecraftUsername: args.username,
          emojiUpdated: false,
          totalPlay: 0,
        })

        message.reply(
          `君をマイクラユーザー \`${args.username}\` に紐づけたよ。`
        )
      }

      await setUsers(users)
    } else {
      message.reply(
        `\`${args.username}\` というユーザーはマイクラに存在しないよ。`
      )
    }
  })

  app.command('help', (message) => {
    const embed = new MessageEmbed()
    embed.setTitle(process.env.BOT_NAME)
    embed.setDescription(process.env.BOT_DESCRIPTION)
    embed.setThumbnail(app.client.user?.avatarURL() ?? '')
    embed.setColor('#f0e0e0')
    embed.addField('ホスト', `\`${process.env.MC_HOST}\``, true)
    embed.addField(
      'ポート',
      (process.env.MC_PORT as string) === '25565'
        ? '`デフォルト`'
        : `\`${process.env.MC_PORT}\``,
      true
    )
    embed.addField(
      `サーバーに参加する際は下記コマンドを実行してください。(例: \`${app.prefixes[0]}join hota1024\`)`,
      `\`${app.prefixes[0]}join マイクラのユーザー名\``
    )
    embed.addField(
      `\`${app.prefixes[0]}list\``,
      '**サーバーに参加しているユーザーの詳細情報を表示するよ。**',
      true
    )
    embed.addField(
      `\`${app.prefixes[0]}profile\``,
      '**自分の詳細情報を表示するよ。**',
      true
    )
    embed.addField(
      `\`${app.prefixes[0]}profile {username: string}\``,
      '**マイクラのユーザーの詳細情報を表示するよ。**',
      true
    )

    message.reply(embed)
  })

  app.command('set guild', async (message) => {
    if (message.guild) {
      await setGuild(message.guild.id)
      message.reply('このサーバーをメインのサーバーに設定したよ。')
    }
  })

  const getProfileEmbed = (data: UserData) => {
    const embed = new MessageEmbed()
    embed.setTitle(`${data.minecraftUsername} さんのプロフィール`)
    embed.setThumbnail(
      `https://mc-heads.net/body/${data.minecraftUsername}/left`
    )
    embed.addField('Discord', `<@${data.discordId}>`, true)
    embed.addField('Minecraft', `\`${data.minecraftUsername}\``, true)
    embed.addField('絵文字', `<:a:${data.emojiId}>`, true)
    embed.addField('プレイ時間', `**${data.totalPlay}秒**`, true)

    return embed
  }

  app.command('profile {username: string}', async (message, { args }) => {
    const users = await getUsers()
    const user = users.find((u) => u.minecraftUsername === args.username)

    if (user) {
      message.reply(getProfileEmbed(user))
    }
  })

  app.command('profile', async (message) => {
    const users = await getUsers()
    const user = users.find((u) => u.discordId === message.author.id)

    if (user) {
      message.reply(getProfileEmbed(user))
    }
  })

  app.command('list', async (message) => {
    const users = await getUsers()

    for (const user of users) {
      message.channel.send(getProfileEmbed(user))
    }
  })

  app.command(
    'monitor playerList {mode: string}',
    async (message, { args }) => {
      const monitor = await getActivityMonitor()

      if (args.mode === 'on') {
        if (monitor.playerListChannel && monitor.playerListMessage) {
          const channel = await app.client.channels.fetch(
            monitor.playerListChannel
          )
          if (channel?.isText()) {
            const message = await channel.messages.fetch(
              monitor.playerListMessage
            )
            message?.delete()
          }
        }

        monitor.playerListChannel = message.channel.id
        const { id } = await message.channel.send(
          new MessageEmbed({
            title: 'プレイ中のユーザー',
            description: '更新を待っているよ。',
          })
        )
        monitor.playerListMessage = id
      } else if (args.mode === 'off') {
        if (monitor.playerListChannel && monitor.playerListMessage) {
          const channel = await app.client.channels.fetch(
            monitor.playerListChannel
          )
          if (channel?.isText()) {
            const message = await channel.messages.fetch(
              monitor.playerListMessage
            )
            message?.delete()
          }
        }

        monitor.playerListChannel = void 0
        monitor.playerListMessage = void 0
      }

      setActivityMonitor(monitor)
    }
  )

  app.command('$debug', (message) => {
    message.reply('```' + message.content + '```')
  })

  app.login(process.env.BOT_TOKEN as string)

  setInterval(async () => {
    const count = await countOnline()
    app.client.user?.setActivity(`::help | ${count} 人がプレイ中`, {
      type: 'PLAYING',
    })
  }, 1000)

  setInterval(async () => {
    const players = await listOnline()

    for (const player of players) {
      const users = await getUsers()
      const user = users.find((u) => u.minecraftUsername === player)

      if (user) {
        user.totalPlay += 1
        await setUsers(users)
      }
    }
  }, 1000)

  setInterval(async () => {
    const { playerListChannel, playerListMessage } = await getActivityMonitor()

    if (playerListChannel && playerListMessage) {
      const channel = await app.client.channels.fetch(playerListChannel)
      if (channel?.isText()) {
        const message = await channel.messages.fetch(playerListMessage)

        const users = await listOnline()

        const embed = new MessageEmbed()
        embed.setTitle(`プレイ中のユーザー`)

        if (users.length === 0) {
          embed.setDescription('今は誰も遊んでないよ。')
        } else {
          embed.setDescription(`${users.length} 人がオンラインだよ。`)
        }

        const dataList = await getUsers()
        for (const user of users) {
          const data = dataList.find((u) => u.minecraftUsername === user)
          if (!data) {
            continue
          }

          const res = await rcon.send(
            `data get entity ${data.minecraftUsername}`
          )
          const posMatches = res.match(/Pos: \[(.+d), (.+d), (.+d)\]/)

          if (posMatches) {
            const healthMatches = res.match(/Health: ([\d.]+f)/)

            if (healthMatches) {
              embed.addField(
                `<:a:${data?.emojiId}> ${user} (${data.totalPlay})`,
                '```css\n' +
                  `HP: ${healthMatches[1]}\nx: ${posMatches[1]}\ny: ${posMatches[2]}\nz: ${posMatches[3]}` +
                  '\n```'
              )
            }
          }
        }

        message?.edit(embed)
      }
    }
  }, 3000)

  setInterval(async () => {
    const guildId = await getGuild()

    if (!guildId) {
      return
    }

    const guild = await app.client.guilds.fetch(guildId)

    const users = await getUsers()

    for (const user of users) {
      const { discordId, minecraftUsername, emojiId, emojiUpdated } = user

      if (emojiUpdated) {
        continue
      }

      const discordUser = await app.client.users.fetch(discordId)

      if (emojiId) {
        const emoji = guild.emojis.cache.get(emojiId)
        await emoji?.delete()
      }

      const emoji = await guild.emojis.create(
        `https://mc-heads.net/avatar/${minecraftUsername}/`,
        getHeadEmoji(discordUser)
      )
      user.emojiId = emoji.id
      user.emojiUpdated = true

      await setUsers(users)
    }
  }, 5000)
}

main()
