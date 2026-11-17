// MarkVault 文档站脚本：语言切换、主题切换、代码复制、截图放大、接口文档目录。
// 页面在禁用脚本时也能完整阅读，这里只做增强。
;(function () {
  'use strict'

  var root = document.documentElement
  var THEME_KEY = 'markvault-docs-theme'
  var LANG_KEY = 'markvault-docs-lang'

  // 脚本生成的界面文字。页面默认是英文，中文页在 zh/ 目录下，按 <html lang> 区分
  var isChinese = (root.getAttribute('lang') || '').toLowerCase().indexOf('zh') === 0
  var text = isChinese
    ? {
        toLight: '切换到明亮模式',
        toDark: '切换到暗色模式',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败',
        zoom: '截图放大',
        close: '关闭',
      }
    : {
        toLight: 'Switch to light mode',
        toDark: 'Switch to dark mode',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        zoom: 'Enlarged screenshot',
        close: 'Close',
      }

  // 语言切换：链接本身指向另一种语言的同一页。这里只做两件事：
  // 记住这次选择（英文页的 <head> 脚本据此把选过中文的访客带回中文页），并保留当前锚点
  var langSwitch = document.querySelector('.lang-switch')
  if (langSwitch) {
    langSwitch.addEventListener('click', function () {
      try {
        localStorage.setItem(LANG_KEY, isChinese ? 'en' : 'zh')
      } catch (error) {
        // 无法保存时只是不记住选择，链接照常跳转
      }
      if (location.hash) langSwitch.hash = location.hash
    })
  }

  // 主题切换：初始主题由 <head> 里的内联脚本设置，这里只处理点击
  var toggle = document.querySelector('.theme-toggle')
  function describeToggle() {
    if (!toggle) return
    var dark = root.getAttribute('data-theme') === 'dark'
    toggle.setAttribute('aria-label', dark ? text.toLight : text.toDark)
    toggle.setAttribute('title', dark ? text.toLight : text.toDark)
  }
  if (toggle) {
    describeToggle()
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
      root.setAttribute('data-theme', next)
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch (error) {
        // 无法保存时只在本次访问生效
      }
      describeToggle()
    })
  }

  // 代码块复制按钮
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      var done = false
      try {
        done = document.execCommand('copy')
      } catch (error) {
        done = false
      }
      document.body.removeChild(area)
      if (done) resolve()
      else reject(new Error('copy failed'))
    })
  }
  Array.prototype.forEach.call(document.querySelectorAll('pre'), function (pre) {
    var wrap = document.createElement('div')
    wrap.className = 'pre-wrap'
    pre.parentNode.insertBefore(wrap, pre)
    wrap.appendChild(pre)
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    button.textContent = text.copy
    button.addEventListener('click', function () {
      copyText(pre.textContent.replace(/\n$/, '')).then(
        function () {
          button.textContent = text.copied
          setTimeout(function () {
            button.textContent = text.copy
          }, 1600)
        },
        function () {
          button.textContent = text.copyFailed
          setTimeout(function () {
            button.textContent = text.copy
          }, 1600)
        }
      )
    })
    wrap.appendChild(button)
  })

  // 截图放大：不支持 <dialog> 的浏览器保留链接的默认行为（直接打开图片）
  var zoomLinks = document.querySelectorAll('a[data-zoom]')
  if (zoomLinks.length && typeof HTMLDialogElement === 'function') {
    var dialog = document.createElement('dialog')
    dialog.className = 'lightbox'
    dialog.setAttribute('aria-label', text.zoom)
    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'lightbox-close'
    close.setAttribute('aria-label', text.close)
    close.textContent = '×'
    var image = document.createElement('img')
    image.alt = ''
    var caption = document.createElement('p')
    dialog.appendChild(close)
    dialog.appendChild(image)
    dialog.appendChild(caption)
    document.body.appendChild(dialog)
    close.addEventListener('click', function () {
      dialog.close()
    })
    // 点击图片以外的区域关闭
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close()
    })
    Array.prototype.forEach.call(zoomLinks, function (link) {
      link.addEventListener('click', function (event) {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        var thumb = link.querySelector('img')
        image.src = link.getAttribute('href')
        image.alt = thumb ? thumb.alt : ''
        caption.textContent = thumb ? thumb.alt : ''
        dialog.showModal()
      })
    })
  }

  // 接口文档目录：窄屏折叠，滚动时高亮当前小节
  var toc = document.querySelector('.toc')
  if (toc) {
    var tocToggle = toc.querySelector('.toc-toggle')
    var narrow = window.matchMedia('(max-width: 960px)')
    function setCollapsed(collapsed) {
      toc.classList.toggle('collapsed', collapsed)
      if (tocToggle) tocToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true')
    }
    setCollapsed(narrow.matches)
    if (tocToggle) {
      tocToggle.addEventListener('click', function () {
        setCollapsed(!toc.classList.contains('collapsed'))
      })
    }
    var links = Array.prototype.slice.call(toc.querySelectorAll('a[href^="#"]'))
    links.forEach(function (link) {
      link.addEventListener('click', function () {
        if (narrow.matches) setCollapsed(true)
      })
    })
    var targets = links
      .map(function (link) {
        return document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)))
      })
      .filter(Boolean)
    function highlight() {
      // 取最后一个已经滚过页头下沿的标题
      var line = 90
      var current = targets[0]
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].getBoundingClientRect().top <= line) current = targets[i]
        else break
      }
      // 页面滚到底时，末尾较短的小节到不了页头下沿，直接取最后一个
      var page = document.documentElement
      if (window.innerHeight + window.scrollY >= page.scrollHeight - 2) {
        current = targets[targets.length - 1]
      }
      links.forEach(function (link) {
        var active = current && link.getAttribute('href') === '#' + current.id
        link.classList.toggle('active', !!active)
        if (active) link.setAttribute('aria-current', 'location')
        else link.removeAttribute('aria-current')
        // 目录自身可滚动时，让当前项保持在目录的可视范围内
        if (active && toc.scrollHeight > toc.clientHeight) {
          var box = link.getBoundingClientRect()
          var frame = toc.getBoundingClientRect()
          if (box.top < frame.top) toc.scrollTop -= frame.top - box.top + 8
          else if (box.bottom > frame.bottom) toc.scrollTop += box.bottom - frame.bottom + 8
        }
      })
    }
    var ticking = false
    window.addEventListener(
      'scroll',
      function () {
        if (ticking) return
        ticking = true
        requestAnimationFrame(function () {
          ticking = false
          highlight()
        })
      },
      { passive: true }
    )
    window.addEventListener('resize', highlight)
    highlight()
  }
})()
