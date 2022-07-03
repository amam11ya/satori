import { remove } from 'cosmokit'
import { Context } from '.'
import { Adapter } from './adapter'
import { Session } from './session'
import { Methods, UserBase } from './protocol'

export interface Bot extends Bot.BaseConfig, Methods, UserBase {}

export abstract class Bot<T extends Bot.BaseConfig = Bot.BaseConfig> {
  static reusable = true

  public platform: string
  public hidden?: boolean
  public internal?: any
  public selfId?: string
  public adapter?: Adapter<this>

  private _status: Bot.Status = 'offline'

  error?: Error

  constructor(public ctx: Context, public config: T) {
    if (config.platform) {
      this.platform = config.platform
    }

    ctx.bots.push(this)
    ctx.emit('bot-added', this)
    ctx.on('ready', () => this.start())
    ctx.on('dispose', () => {
      remove(ctx.bots, this)
      ctx.emit('bot-removed', this)
      this.stop()
    })
  }

  get status() {
    return this._status
  }

  set status(value) {
    this._status = value
    if (this.ctx.bots.includes(this)) {
      this.ctx.emit('bot-status-updated', this)
    }
  }

  resolve() {
    this.status = 'online'
  }

  reject(error: Error) {
    this.error = error
    this.status = 'offline'
  }

  async start() {
    if (['connect', 'reconnect', 'online'].includes(this.status)) return
    this.status = 'connect'
    try {
      await this.ctx.parallel('bot-connect', this)
      await this.adapter.start(this)
    } catch (error) {
      this.reject(error)
    }
  }

  async stop() {
    if (['disconnect', 'offline'].includes(this.status)) return
    this.status = 'disconnect'
    try {
      await this.ctx.parallel('bot-disconnect', this)
      await this.adapter.stop(this)
    } catch (error) {
      this.ctx.emit('internal/warning', error)
    }
    this.status = 'offline'
  }

  get sid() {
    return `${this.platform}:${this.selfId}`
  }

  async session(data: Partial<Session>) {
    const session = new Session(this, {
      ...data,
      type: 'send',
      selfId: this.selfId,
      platform: this.platform,
      timestamp: Date.now(),
      author: {
        userId: this.selfId,
        username: this.username,
        avatar: this.avatar,
        discriminator: this.discriminator,
        isBot: true,
      },
    })
    if (await this.ctx.serial(session, 'before-send', session)) return
    return session
  }

  dispatch(session: Session) {
    if (!this.ctx.lifecycle.isActive) return
    const events: string[] = [session.type]
    if (session.subtype) {
      events.unshift(events[0] + '/' + session.subtype)
      if (session.subsubtype) {
        events.unshift(events[0] + '/' + session.subsubtype)
      }
    }
    for (const event of events) {
      this.ctx.emit(session, event as any, session)
    }
  }
}

export namespace Bot {
  export interface BaseConfig {
    protocol?: string
    platform?: string
  }

  export interface Constructor<S extends Bot.BaseConfig = Bot.BaseConfig, T extends Bot<S> = Bot<S>> {
    new (ctx: Context, config: S): T
  }

  export type Status = 'offline' | 'online' | 'connect' | 'disconnect' | 'reconnect'

}