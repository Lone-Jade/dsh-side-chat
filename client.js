/**
 * Browser half of the Side chat bundle.
 *
 * The plugin adds one right-Sidebar tab type, its guide card, a header button
 * that opens it, and one composer control that quotes the user's selection
 * from the main conversation:
 *
 *  - `sidebarRightTabs.register` declares the page type and its guide entry;
 *  - `sidebar.right.pane.tab` registers the tab body under the same type id;
 *  - the body declares one child slot and renders the shared Conversation
 *    content for a side Session it creates on demand;
 *  - `conversation.session.header.utilities` adds the entry button;
 *  - `conversation.input.left` adds the quote control to the side chat's own
 *    composer (it renders nothing for ordinary Sessions).
 *
 * The side Session's id encodes the main conversation:
 *
 *   sidechat__<mainSessionId>__<generation>
 *
 * so reopening the tab (or reloading the page) resolves the same thread from
 * the same main Session, and the Host half can rebuild the reference prompt
 * from that id alone. Nothing here writes to the main Session.
 */
window.__ModuleLoader__.load({
  id: '@lonejade/dsh-side-chat',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** This bundle's package name; also the tab type's implementation identity. */
    const PACKAGE = '@lonejade/dsh-side-chat'
    /** Page type discriminator, prefixed with the package so it cannot collide. */
    const KIND = `${PACKAGE}:side-chat`
    /** Client locale namespace for every visible string. */
    const NAMESPACE = 'sideChat'
    /** Reference-source label this plugin reports while it holds a Session. */
    const SOURCE_LABEL = 'uiSideChat'
    /** Child slot hosting the embedded Conversation. */
    const CONVERSATION_SLOT = 'sideChatConversation'
    /** Session id prefix shared with the Host half. */
    const SESSION_PREFIX = 'sidechat__'
    /** `sidechat__<main>__<generation>`; main ids never contain `__`. */
    const SESSION_PATTERN = /^sidechat__(.+)__(\d+)$/
    /** localStorage key holding the current generation per main Session. */
    const STORAGE_KEY = 'dsh.side-chat.v1'
    /** The read-only preset the side Session runs. */
    const SIDE_PRESET = 'side-chat'
    /** Longest selection the quote control will carry. */
    const SELECTION_LIMIT = 4000
    /** Display-width budget (half-width character units) of the quote control's preview. */
    const PREVIEW_UNITS = 24
    /** Stable empty results, so an unbound Session never republishes state. */
    const EMPTY_STATE = Object.freeze({ status: 'error', sessionId: undefined, reference: undefined, error: 'unavailable' })
    const EMPTY_STORE = Object.freeze({
      subscribe: () => () => {},
      getSnapshot: () => EMPTY_STATE,
      newChat: () => {},
      retry: () => {},
      dispose: () => {},
    })

    const ZH = {
      title: '侧边聊天',
      description: '与主对话并行提问，不打断主对话。只读，不改动工作区。',
      open: '打开侧边聊天',
      status: '与主对话并行 · 只读',
      newChat: '新对话',
      creating: '正在准备侧边会话…',
      failed: '侧边会话创建失败',
      retry: '重试',
      unavailable: '请先打开一个会话。',
      quote: '引用选中文本',
      quoteClear: '清除引用',
      quotePreview: '引用自主对话',
      noConversation: '对话界面暂不可用，请刷新页面后重试。',
    }

    const EN = {
      title: 'Side chat',
      description: 'Ask about the task in parallel without interrupting the main conversation. Read-only; it cannot change the workspace.',
      open: 'Open side chat',
      status: 'Parallel to the main conversation · read-only',
      newChat: 'New chat',
      creating: 'Preparing the side conversation…',
      failed: 'Could not create the side conversation',
      retry: 'Retry',
      unavailable: 'Open a conversation first.',
      quote: 'Quote selection',
      quoteClear: 'Clear quote',
      quotePreview: 'Quoted from the main conversation',
      noConversation: 'The conversation surface is unavailable; refresh the page and retry.',
    }

    /** Whether one Session id belongs to a side chat. */
    const isSideChatId = (id) => typeof id === 'string' && SESSION_PATTERN.test(id)

    /** The deterministic Session id for one main conversation and generation. */
    const sideSessionId = (mainId, generation) => `${SESSION_PREFIX}${mainId}__${generation}`

    /** Read the current generation of one main conversation. */
    const generationOf = (mainId) => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        const all = raw === null ? {} : JSON.parse(raw)
        const value = all !== null && typeof all === 'object' ? all[mainId] : undefined
        return Number.isInteger(value) && value >= 0 ? value : 0
      } catch (_unavailable) {
        return 0
      }
    }

    /** Remember the current generation of one main conversation. */
    const rememberGeneration = (mainId, generation) => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        const parsed = raw === null ? {} : JSON.parse(raw)
        const all = parsed !== null && typeof parsed === 'object' ? parsed : {}
        all[mainId] = generation
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
      } catch (_unavailable) {
        /* storage is optional: a lost generation only starts a fresh thread */
      }
    }

    /** Human-readable text for an unknown thrown value. */
    const messageOf = (error) => {
      if (error === null || error === undefined) return 'unknown'
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message !== '') return error.message
      return String(error)
    }

    // ---- Selection captured from the main conversation -------------------

    const selectionListeners = new Set()
    let selectionState = Object.freeze({ text: '' })

    const publishSelection = (text) => {
      if (text === selectionState.text) return
      selectionState = Object.freeze({ text })
      for (const listener of selectionListeners) listener()
    }

    const subscribeSelection = (listener) => {
      selectionListeners.add(listener)
      return () => { selectionListeners.delete(listener) }
    }

    const getSelectionState = () => selectionState

    /**
     * Whether a DOM node belongs to a sidebar surface, this plugin's own panel,
     * or a composer: those selections are not quotes from the main conversation.
     */
    const insidePluginSurfaces = (node) => {
      const element = node !== null && typeof node === 'object' && node.nodeType === 1 ? node : node?.parentElement
      if (typeof element?.closest !== 'function') return false
      return element.closest('[data-sidebar-right-session], [data-side-chat], [data-composer-card]') !== null
    }

    /** Capture the live document selection when it comes from the main conversation. */
    const captureSelection = () => {
      const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return
      const text = selection.toString().trim()
      if (text === '' || text.length > SELECTION_LIMIT) return
      if (insidePluginSurfaces(selection.anchorNode)) return
      publishSelection(text)
    }

    /** Render one selection as a Markdown blockquote ready for the side-chat draft. */
    const quoteBlock = (text) => `${text.split('\n').map(line => `> ${line}`).join('\n')}\n\n`

    /** Display width of one character in half-width units; CJK and full-width glyphs count double. */
    const charWidth = (ch) => (/[\u1100-\u115f\u2e80-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(ch) ? 2 : 1)

    /** Display width of a string in half-width units. */
    const widthOf = (text) => {
      let width = 0
      for (const ch of text) width += charWidth(ch)
      return width
    }

    /**
     * Take characters from the start until `budget` half-width units are filled.
     * @param chars - the character list to read.
     * @param budget - half-width units available.
     * @returns the characters that fit, in their original order.
     */
    const takeByWidth = (chars, budget) => {
      let width = 0
      const out = []
      for (const ch of chars) {
        const step = charWidth(ch)
        if (width + step > budget) break
        width += step
        out.push(ch)
      }
      return out
    }

    /**
     * Compact one captured selection for the composer control: keep its head
     * and tail and join them with an ellipsis, so a long quote never widens the
     * composer row. Budgets are measured in display width, so a CJK-heavy
     * selection elides exactly like a Latin one. The full text still reaches
     * the draft on click.
     * @param text - the captured selection.
     * @returns at most `PREVIEW_UNITS` half-width units with a middle ellipsis.
     */
    const previewOf = (text) => {
      const compact = text.replace(/\s+/gu, ' ').trim()
      if (widthOf(compact) <= PREVIEW_UNITS) return compact
      const chars = Array.from(compact)
      const headBudget = Math.ceil((PREVIEW_UNITS - 1) * 0.6)
      const tailBudget = PREVIEW_UNITS - 1 - headBudget
      const head = takeByWidth(chars, headBudget).join('')
      const tail = takeByWidth(chars.slice().reverse(), tailBudget).reverse().join('')
      return `${head}…${tail}`
    }

    // ---- Shared glyphs ---------------------------------------------------

    /** The guide/header glyph: a speech bubble with a sidebar divider. */
    function SideChatIcon(iconProps) {
      const size = iconProps !== null && typeof iconProps === 'object' && typeof iconProps.size === 'number'
        ? iconProps.size
        : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': true,
        focusable: 'false',
        style: { display: 'block' },
      },
        h('path', {
          key: 'bubble',
          d: 'M2.2 3.4h8.1a1.4 1.4 0 0 1 1.4 1.4v5.3a1.4 1.4 0 0 1-1.4 1.4H6.4L3.4 13.9v-2.4H2.2a1.4 1.4 0 0 1-1.4-1.4V4.8a1.4 1.4 0 0 1 1.4-1.4Z',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        h('path', {
          key: 'divider',
          d: 'M11.6 2.2v11.6',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
        h('path', {
          key: 'dots',
          d: 'M4.4 7.6h.01M6.4 7.6h.01M8.4 7.6h.01',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
      )
    }

    /** Panel stylesheet: one prefixed block the panel's own unmount removes. */
    const STYLES = `
.dshsc-root{display:flex;flex-direction:column;box-sizing:border-box;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsh-font-family-text,inherit);font-size:var(--dsh-content-font-size-secondary,13px)}
.dshsc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;padding:7px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dshsc-status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px}
.dshsc-new{flex:none;height:24px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.dshsc-new:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshsc-new:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshsc-body{display:flex;flex:1;min-height:0;flex-direction:column}
.dshsc-conversation{display:flex;flex:1;min-height:0;flex-direction:column}
.dshsc-notice{display:flex;flex:1;min-height:0;flex-direction:column;align-items:flex-start;gap:10px;padding:14px 12px;color:var(--dsw-alias-label-secondary)}
.dshsc-notice p{margin:0;line-height:1.5}
.dshsc-error{color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
.dshsc-retry{height:26px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.dshsc-retry:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dshsc-header-button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;margin:0;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshsc-header-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshsc-header-button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshsc-quote{display:inline-flex;align-items:center;gap:2px;min-width:0;max-width:240px;flex:0 1 auto;overflow:hidden}
.dshsc-quote-button{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:220px;height:24px;padding:0 6px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;overflow:hidden}
.dshsc-quote-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshsc-quote-button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dshsc-quote-mark{flex:none;font-size:11px;line-height:1;opacity:.75}
.dshsc-quote-label{min-width:0;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshsc-quote-clear{flex:none;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}
.dshsc-quote-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'sessions'],

      /**
       * Register the tab type, its body, the entry button, the quote control,
       * and the per-main-conversation side Session stores.
       * @param ctx - Client root Context with sidebar, locale, slot, and session services.
       */
      apply(ctx) {
        const t = ctx.locale.bind(NAMESPACE)
        /** One side-Session store per main conversation, for the Session on screen. */
        const stores = new Map()

        ctx.effect(() => ctx.locale.register(NAMESPACE, { zh: ZH, en: EN }), 'side-chat: copy')

        /**
         * Create the store for one main conversation, or return the existing one.
         * @param mainSessionId - the conversation the side chat belongs to.
         * @returns its store.
         */
        const storeFor = (mainSessionId) => {
          if (typeof mainSessionId !== 'string' || mainSessionId === '') return EMPTY_STORE
          const existing = stores.get(mainSessionId)
          if (existing !== undefined) return existing
          const listeners = new Set()
          let state = Object.freeze({ status: 'creating', sessionId: undefined, reference: undefined, error: '' })
          let reference
          let disposed = false
          const publish = (next) => {
            if (disposed) return
            state = Object.freeze(next)
            for (const listener of Array.from(listeners)) listener()
          }
          const release = () => {
            const held = reference
            reference = undefined
            if (held === undefined) return
            try {
              held.release()
            } catch (_unavailable) {
              /* the generation is already gone */
            }
          }
          const retain = (sessionId) => {
            let held
            try {
              held = ctx.sessions.retain(sessionId, { source: SOURCE_LABEL })
            } catch (error) {
              publish({ status: 'error', sessionId: undefined, reference: undefined, error: messageOf(error) })
              return
            }
            if (disposed) {
              try {
                held.release()
              } catch (_unavailable) { /* already released */ }
              return
            }
            reference = held
            publish({ status: 'ready', sessionId, reference: held, error: '' })
          }
          const ensure = async () => {
            if (disposed) return
            const generation = generationOf(mainSessionId)
            const wanted = sideSessionId(mainSessionId, generation)
            const snapshot = ctx.sessions.list.getSnapshot()
            if (snapshot.byId[wanted] !== undefined) {
              retain(wanted)
              return
            }
            const summary = snapshot.byId[mainSessionId]
            const cwd = typeof summary?.cwd === 'string' && summary.cwd !== '' ? summary.cwd : undefined
            try {
              const created = await ctx.sessions.create({
                sessionId: wanted,
                agentPreset: SIDE_PRESET,
                ...(cwd === undefined ? {} : { cwd }),
              })
              if (disposed) return
              retain(created)
            } catch (error) {
              if (!disposed) publish({ status: 'error', sessionId: undefined, reference: undefined, error: messageOf(error) })
            }
          }
          const store = {
            subscribe(listener) {
              if (disposed) return () => {}
              listeners.add(listener)
              return () => { listeners.delete(listener) }
            },
            getSnapshot() {
              return state
            },
            /** Start a fresh thread for the same main conversation. */
            newChat() {
              if (disposed) return
              rememberGeneration(mainSessionId, generationOf(mainSessionId) + 1)
              release()
              publish({ status: 'creating', sessionId: undefined, reference: undefined, error: '' })
              void ensure()
            },
            /** Retry a failed creation without changing the generation. */
            retry() {
              if (disposed) return
              release()
              publish({ status: 'creating', sessionId: undefined, reference: undefined, error: '' })
              void ensure()
            },
            dispose() {
              if (disposed) return
              disposed = true
              listeners.clear()
              release()
            },
          }
          stores.set(mainSessionId, store)
          void ensure()
          return store
        }

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: PACKAGE,
          kind: KIND,
          priority: 'extension',
          title: () => t('title'),
          guide: [{
            id: 'open',
            order: 55,
            title: () => t('title'),
            description: () => t('description'),
            icon: SideChatIcon,
          }],
        }), 'side-chat: tab type')

        /** The embedded Conversation: the shared content for the side Session. */
        function SideChatConversation(props) {
          const renderFactorySlot = props.renderFactorySlot
          if (typeof renderFactorySlot !== 'function') {
            return h('div', { className: 'dshsc-notice' }, h('p', null, t('noConversation')))
          }
          // The side chat is always a working chat: never the New Session hero.
          const phase = 'active'
          return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero: false }, {
            slots: { views: FixedChatView },
          })
        }

        /** Keep the embedded Conversation on its Chat view. */
        function FixedChatView(props) {
          return props.renderSlot('conversation.session', { view: 'chat' })
        }

        /** The tab body: chrome plus the side Session's Conversation. */
        function SideChatTab(props) {
          const store = props.sideChat === undefined ? EMPTY_STORE : props.sideChat
          const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
          const SessionProvider = props.SessionProvider
          const renderSlot = props.renderSlot
          let body
          if (state.status === 'ready' && state.reference !== undefined && typeof SessionProvider === 'function' && typeof renderSlot === 'function') {
            body = h('div', { className: 'dshsc-body' },
              h('div', { className: 'dshsc-conversation' },
                h(SessionProvider, { session: state.reference },
                  renderSlot(CONVERSATION_SLOT, {}))))
          } else if (state.status === 'error') {
            body = h('div', { className: 'dshsc-notice' },
              h('p', null, state.error === 'unavailable' ? t('unavailable') : t('failed')),
              state.error !== '' && state.error !== 'unavailable'
                ? h('p', { className: 'dshsc-error' }, state.error)
                : null,
              h('button', {
                type: 'button',
                className: 'dshsc-retry',
                onClick: () => { store.retry() },
              }, t('retry')))
          } else {
            body = h('div', { className: 'dshsc-notice' }, h('p', null, t('creating')))
          }
          return h('div', { className: 'dshsc-root', 'data-side-chat': '' },
            h('style', { key: 'styles' }, STYLES),
            h('div', { className: 'dshsc-head' },
              h('span', { className: 'dshsc-status', title: t('status') }, t('status')),
              h('button', {
                type: 'button',
                className: 'dshsc-new',
                onClick: () => { store.newChat() },
              }, t('newChat'))),
            body)
        }

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: PACKAGE,
          locale: NAMESPACE,
          inject: (sessionId) => ({ sideChat: storeFor(sessionId) }),
          children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
        }, SideChatTab)), 'side-chat: tab body')

        ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
          name: CONVERSATION_SLOT,
          locale: NAMESPACE,
        }, SideChatConversation)), 'side-chat: conversation')

        /** Open the side chat for the Session on screen; capture the selection first. */
        const openSideChat = () => {
          captureSelection()
          try {
            ctx.sidebarRight.openTab(KIND)
          } catch (_unavailable) {
            /* no Session surface is mounted yet */
          }
        }

        /** The main conversation header's entry button. */
        function OpenButton() {
          return h('button', {
            type: 'button',
            className: 'dshsc-header-button',
            title: t('open'),
            'aria-label': t('open'),
            onPointerDown: () => { captureSelection() },
            onClick: openSideChat,
          }, h(SideChatIcon, { size: 15 }))
        }

        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'side-chat-open',
          order: 40,
          locale: NAMESPACE,
        }, OpenButton)), 'side-chat: header button')

        /** Insert the captured main-conversation selection into the side chat draft. */
        function QuoteControl(props) {
          const current = React.useSyncExternalStore(subscribeSelection, getSelectionState, getSelectionState)
          const sessionId = props.sessionId
          const actions = props.inputActions
          if (!isSideChatId(sessionId) || current.text === '' || actions === undefined) return null
          const preview = previewOf(current.text)
          return h('span', { className: 'dshsc-quote' },
            h('button', {
              type: 'button',
              className: 'dshsc-quote-button',
              title: `${t('quotePreview')}：${preview}`,
              'aria-label': t('quote'),
              onPointerDown: () => { captureSelection() },
              onClick: () => {
                // Read the live store: pointerdown may have just refreshed it,
                // while this render's closure still holds the previous value.
                captureSelection()
                const text = getSelectionState().text
                if (text === '') return
                let inserted
                try {
                  inserted = actions.insertText(quoteBlock(text), actions.captureInsertion())
                } catch (_unavailable) {
                  return
                }
                if (inserted !== false) publishSelection('')
              },
            },
            h('span', { className: 'dshsc-quote-mark', 'aria-hidden': 'true' }, '❝'),
            h('span', { className: 'dshsc-quote-label' }, preview)),
            h('button', {
              type: 'button',
              className: 'dshsc-quote-clear',
              title: t('quoteClear'),
              'aria-label': t('quoteClear'),
              onClick: () => { publishSelection('') },
            }, '×'))
        }

        ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'side-chat-quote',
          order: 20,
          locale: NAMESPACE,
        }, QuoteControl)), 'side-chat: quote control')

        ctx.effect(() => {
          const onSelectionChange = () => { captureSelection() }
          const onPointerUp = (event) => {
            const target = event.target
            if (target !== null && typeof target === 'object' && typeof target.closest === 'function' && target.closest('.dshsc-quote') !== null) return
            // A drag settles its selection after pointerup; read it on the next task.
            window.setTimeout(captureSelection, 0)
          }
          document.addEventListener('selectionchange', onSelectionChange)
          document.addEventListener('pointerup', onPointerUp, true)
          return () => {
            document.removeEventListener('selectionchange', onSelectionChange)
            document.removeEventListener('pointerup', onPointerUp, true)
          }
        }, 'side-chat: selection capture')

        ctx.effect(() => {
          let active
          const activate = (sessionId) => {
            if (sessionId === active) return
            active = sessionId
            for (const [id, store] of stores) {
              if (id === sessionId) continue
              stores.delete(id)
              store.dispose()
            }
          }
          activate(ctx.sidebarRight.mounted.getSnapshot())
          const unsubscribe = ctx.sidebarRight.mounted.subscribe(() => {
            activate(ctx.sidebarRight.mounted.getSnapshot())
          })
          return () => {
            unsubscribe()
            for (const store of stores.values()) store.dispose()
            stores.clear()
          }
        }, 'side-chat: sessions')
      },
    }
  },
})
