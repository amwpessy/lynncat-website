(function () {
  var storageKey = "lynncat-markets-language";

  function preferredLanguage() {
    try {
      var saved = localStorage.getItem(storageKey);
      if (saved === "zh" || saved === "en") return saved;
    } catch (error) {
      // Language persistence is optional.
    }
    return navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function updateMenuLabel() {
    var toggle = document.querySelector("[data-nav-toggle]");
    if (!toggle) return;
    var chinese = document.body.getAttribute("data-lang") === "zh";
    var open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-label", chinese
      ? (open ? "关闭菜单" : "打开菜单")
      : (open ? "Close menu" : "Open menu"));
  }

  function applyLanguage(language) {
    document.body.setAttribute("data-lang", language);
    document.documentElement.lang = language === "zh" ? "zh-Hans" : "en";
    document.title = language === "zh"
      ? "Lynncat Markets — 全球市场驾驶舱"
      : "Lynncat Markets — Global Market Cockpit";
    document.querySelectorAll("[data-lang-toggle]").forEach(function (button) {
      button.setAttribute("aria-label", language === "zh" ? "Switch to English" : "切换到简体中文");
    });
    try {
      localStorage.setItem(storageKey, language);
    } catch (error) {
      // The site remains usable without local storage.
    }
    updateMenuLabel();
  }

  window.toggleSiteLanguage = function () {
    applyLanguage(document.body.getAttribute("data-lang") === "zh" ? "en" : "zh");
  };

  applyLanguage(preferredLanguage());

  document.querySelectorAll("[data-current-year]").forEach(function (node) {
    node.textContent = String(new Date().getFullYear());
  });

  var navToggle = document.querySelector("[data-nav-toggle]");
  var navMenu = document.getElementById("nav-menu");
  if (navToggle && navMenu) {
    function setMenuOpen(open, restoreFocus) {
      navMenu.classList.toggle("open", open);
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      updateMenuLabel();
      if (!open && restoreFocus) navToggle.focus();
    }

    navToggle.addEventListener("click", function () {
      setMenuOpen(!navMenu.classList.contains("open"), false);
    });

    navMenu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        setMenuOpen(false, false);
      });
    });

    document.addEventListener("click", function (event) {
      if (navMenu.classList.contains("open") && !navMenu.contains(event.target) && !navToggle.contains(event.target)) {
        setMenuOpen(false, false);
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && navMenu.classList.contains("open")) {
        setMenuOpen(false, true);
      }
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 960 && navMenu.classList.contains("open")) {
        setMenuOpen(false, false);
      }
    });
  }

  var marketTabs = Array.prototype.slice.call(document.querySelectorAll("[data-market-tab]"));
  var marketPanels = Array.prototype.slice.call(document.querySelectorAll("[data-market-panel]"));

  function selectMarketTab(name, focusTab) {
    marketTabs.forEach(function (tab) {
      var active = tab.getAttribute("data-market-tab") === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
      if (active && focusTab) tab.focus();
    });

    marketPanels.forEach(function (panel) {
      var active = panel.getAttribute("data-market-panel") === name;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });
  }

  marketTabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () {
      selectMarketTab(tab.getAttribute("data-market-tab"), false);
    });

    tab.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      var direction = event.key === "ArrowRight" ? 1 : -1;
      var nextIndex = (index + direction + marketTabs.length) % marketTabs.length;
      selectMarketTab(marketTabs[nextIndex].getAttribute("data-market-tab"), true);
    });
  });

})();
