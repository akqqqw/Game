/**
 * Минимальная типизация JS SDK Яндекс Игр.
 *
 * Официального npm-пакета с типами не существует (`@yandex-games/sdk-types` и
 * `yandex-games-sdk` в реестре отсутствуют), поэтому описываем только те методы,
 * которые реально использует игра. Все необязательные модули помечены `?` —
 * это позволяет безопасно работать со старыми версиями SDK и в локальном режиме.
 *
 * Документация: https://yandex.ru/dev/games/doc/ru/sdk/sdk-about
 */

/** Данные игрока в облаке (лимит платформы — 200 КБ). */
export type YandexPlayerData = Record<string, unknown>

export type YandexPlayer = {
  /** Асинхронно возвращает внутриигровые данные игрока (лимит 100 запросов / 5 минут). */
  getData(keys?: string[]): Promise<YandexPlayerData>
  /** Сохраняет данные игрока (лимит 100 запросов / 5 минут). */
  setData(data: YandexPlayerData, flush?: boolean): Promise<void>
  /** Авторизован ли игрок. Гостевой режим поддерживается платформой. */
  isAuthorized(): boolean
  getUniqueID?(): string
  getName?(): string
  getMode?(): string
}

export type YandexAdCallbacks = {
  onOpen?: () => void
  /** `wasShown === true`, если реклама была показана и закрыта. */
  onClose?: (wasShown: boolean) => void
  onError?: (error: unknown) => void
}

export type YandexRewardedCallbacks = YandexAdCallbacks & {
  /** Вызывается только при засчитанном показе — награду выдаём отсюда. */
  onRewarded?: () => void
}

export type YandexAdv = {
  showFullscreenAdv(options?: { callbacks?: YandexAdCallbacks }): void
  showRewardedVideo(options?: { callbacks?: YandexRewardedCallbacks }): void
}

export type YandexFullscreenApi = {
  request(): Promise<void>
  exit(): Promise<void>
  status?: 'on' | 'off'
}

export type YandexSdk = {
  environment?: {
    i18n?: { lang?: string; tld?: string }
    app?: { id?: string }
  }
  features?: {
    LoadingAPI?: { ready(): void }
    GameplayAPI?: { start(): void; stop(): void }
  }
  adv?: YandexAdv
  screen?: { fullscreen?: YandexFullscreenApi }
  auth?: { openAuthDialog(): Promise<void> }
  /** Лимит платформы — 20 запросов за 5 минут. */
  getPlayer(options?: { scopes?: boolean; signed?: boolean }): Promise<YandexPlayer>
  on?(event: string, callback: () => void): void
  off?(event: string, callback: () => void): void
}

export type YaGamesGlobal = {
  init(options?: { signed?: boolean }): Promise<YandexSdk>
}

/** Событие платформы о необходимости приостановить игру (реклама, окно покупки, свёрнутая вкладка). */
export const SDK_PAUSE_EVENT = 'game_api_pause'
/** Событие платформы о возобновлении игры. */
export const SDK_RESUME_EVENT = 'game_api_resume'

declare global {
  interface Window {
    YaGames?: YaGamesGlobal
  }
}
