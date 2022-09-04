import { createBrowserHistory } from "history"

declare global {
  var routerInitialized: boolean | undefined
}

if (!window.routerInitialized) {
  window.routerInitialized = true
  initRouter()
}

function initRouter() {
  const history = createBrowserHistory()
  const domParser = new DOMParser()

  const executedScriptUrls = new Set(
    [...document.scripts].map((script) => script.src),
  )

  history.listen(async ({ location }) => {
    const response = await fetch(
      location.pathname + location.search + location.hash,
    )

    const newDocument = domParser.parseFromString(
      await response.text(),
      "text/html",
    )

    document.head.replaceWith(newDocument.head)
    document.body.replaceWith(newDocument.body)

    window.dispatchEvent(new Event("router:ready"))

    for (const script of document.scripts) {
      if (script.dataset.astroRouter) continue
      if (script.src && executedScriptUrls.has(script.src)) continue

      if (script.src) {
        executedScriptUrls.add(script.src)
      }

      const newScript = document.createElement("script")
      newScript.type = script.type
      newScript.src = script.src
      newScript.async = script.async
      newScript.defer = script.defer
      newScript.innerHTML = script.innerHTML
      document.head.append(newScript)
      script.remove()
    }
  })

  document.addEventListener("click", (event) => {
    const link = event.composedPath().find((el): el is HTMLAnchorElement => {
      return (
        el instanceof HTMLAnchorElement &&
        el.href.startsWith(window.location.origin) &&
        el.target !== "_blank"
      )
    })
    if (!link) return

    event.preventDefault()
    history.push(link.href)
  })

  document.addEventListener("submit", async (event) => {
    const form = event.composedPath().find((el): el is HTMLFormElement => {
      return el instanceof HTMLFormElement
    })
    if (!form) return

    event.preventDefault()

    try {
      const method = form.method.toUpperCase()
      const formData = new FormData(form)
      const searchParams = new URLSearchParams()

      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") {
          searchParams.append(key, value)
        }
      }

      let url = new URL(form.action, window.location.origin).href
      let init: RequestInit = { method }
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
        url += "?" + searchParams.toString()
      } else {
        init.body = searchParams
        init.headers = {
          "content-type": "application/x-www-form-urlencoded",
        }
      }

      const response = await fetch(url, init)
      if (response.redirected) {
        history.push(response.url)
      }
    } catch (error) {
      console.error(error)
    }
  })

  window.dispatchEvent(new Event("router:ready"))
}
