import type { Location } from "history"
import { createBrowserHistory } from "history"
import morphdom from "morphdom"
import { atom } from "nanostores"

export type RouterState =
  | {
      status: "idle"
      navigation?: never
      submission?: never
      controller?: never
    }
  | {
      status: "navigating"
      navigation: Navigation
      submission?: never
      controller: AbortController
    }
  | {
      status: "submitting"
      navigation?: never
      submission: Submission
      controller: AbortController
    }

export type Navigation = {
  location: Location
}

export type Submission = {
  key: string
  action: string
  method: string
  formData: FormData
}

export type RouterApi = {
  subscribe: (callback: (state: RouterState) => void) => () => void
}

declare global {
  var Router: RouterApi
}

export const Router = (globalThis.Router ??= initRouter())

function initRouter(): RouterApi {
  const routerState = atom<RouterState>({ status: "idle" })
  const history = createBrowserHistory()
  const domParser = new DOMParser()
  const prefetchCache = new Map<
    string,
    { response: Promise<Response>; controller: AbortController }
  >()

  const executedScriptUrls = new Set(
    [...document.scripts].map((script) => script.src),
  )

  const observer = new MutationObserver((mutations) => {
    for (const node of mutations.flatMap((m) => [...m.addedNodes])) {
      if (node instanceof HTMLElement) {
        addListeners(node)
      }
    }
  })

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  })

  history.listen(({ location }) => {
    void renderPage(location)
    prefetchCache.clear()
  })

  for (const node of document.body.querySelectorAll("a, form")) {
    if (node instanceof HTMLElement) addListeners(node)
  }

  function addListeners(node: HTMLElement) {
    node.addEventListener("click", handleLinkClick)
    node.addEventListener("submit", handleFormSubmit)
    node.addEventListener("mouseenter", triggerPrefetch)
    node.addEventListener("focus", triggerPrefetch)
  }

  async function renderPage(location: Location) {
    try {
      routerState.get().controller?.abort()

      const controller = new AbortController()

      routerState.set({
        status: "navigating",
        navigation: { location },
        controller,
      })

      const response = await fetch(
        location.pathname + location.search + location.hash,
        { mode: "same-origin", signal: controller.signal },
      )

      const newDocument = domParser.parseFromString(
        await response.text(),
        "text/html",
      )

      morphdom(document.head, newDocument.head)
      morphdom(document.body, newDocument.body)

      routerState.off()

      for (const script of document.scripts) {
        if (script.src && executedScriptUrls.has(script.src)) continue
        if (script.src) executedScriptUrls.add(script.src)

        const newScript = document.createElement("script")
        if (script.type) newScript.type = script.type
        if (script.src) newScript.src = script.src
        if (script.async) newScript.async = script.async
        if (script.defer) newScript.defer = script.defer
        newScript.innerHTML = script.innerHTML
        document.body.append(newScript)
        script.remove()
      }
    } catch (error) {
      console.error(error)
    } finally {
      const state = routerState.get()
      if (state.navigation?.location.key === location.key) {
        routerState.set({ status: "idle" })
      }
    }
  }

  async function triggerPrefetch(event: Event): Promise<void> {
    // debugger
    const link = event.composedPath().find((el): el is HTMLAnchorElement => {
      return (
        el instanceof HTMLAnchorElement &&
        el.target !== "_blank" &&
        el.rel === "prefetch"
      )
    })
    if (!link) return

    let linkUrl: URL
    try {
      linkUrl = new URL(link.href, window.location.origin)
    } catch (error) {
      console.error(error)
      return
    }

    if (linkUrl.href === window.location.href) {
      return
    }

    const linkPrefetch = document.createElement("link")
    linkPrefetch.rel = "prefetch"
    linkPrefetch.href = linkUrl.href
    link.after(linkPrefetch)
  }

  function handleLinkClick(event: MouseEvent): void {
    if (event.defaultPrevented) return

    const link = event.composedPath().find((el): el is HTMLAnchorElement => {
      return (
        el instanceof HTMLAnchorElement &&
        el.href.startsWith(window.location.origin) &&
        el.target !== "_blank"
      )
    })
    if (!link) return

    event.preventDefault()

    let linkUrl: URL
    try {
      linkUrl = new URL(link.href, window.location.origin)
    } catch (error) {
      console.error(error)
      return
    }

    if (linkUrl.href === window.location.href) {
      return
    }

    history.push(link.href)
  }

  async function handleFormSubmit(event: SubmitEvent): Promise<void> {
    const key = crypto.randomUUID()

    try {
      if (event.defaultPrevented) return

      const form = event.composedPath().find((el): el is HTMLFormElement => {
        return el instanceof HTMLFormElement
      })
      if (!form) return

      event.preventDefault()

      const formData = new FormData(form)
      const searchParams = new URLSearchParams()
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
          searchParams.append(key, value)
        }
      }

      const method = form.method.toUpperCase()
      const controller = new AbortController()
      const init: RequestInit = { method, signal: controller.signal }
      let url = new URL(form.action, window.location.origin).href
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        url += "?" + searchParams.toString()
      } else {
        init.body = searchParams
        init.headers = {
          "content-type": "application/x-www-form-urlencoded",
        }
      }

      routerState.get().controller?.abort()

      routerState.set({
        status: "submitting",
        controller,
        submission: { key, action: form.action, method, formData },
      })

      const response = await fetch(url, init)
      if (response.redirected) {
        history.push(response.url)
      }
    } catch (error) {
      console.error(error)
    }
  }

  return {
    subscribe: (callback) => routerState.subscribe(callback),
  }
}
