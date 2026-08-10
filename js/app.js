(function () {
  "use strict";

  var THEME_KEY = "theme";
  var ADMIN_TOKEN_KEY = "adminToken";
  var manualTileSize = null;
  var adminMode = false;
  var adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || null;
  var selectedIds = new Set();
  var allTags = [];
  var activeFilterTagIds = new Set();
  var tagPickerSelection = new Set();
  var allEvents = [];
  var selectedEventIds = new Set();
  var activeEventFilterId = null;
  var eventPickerSelectedId = null;
  var editingEventId = null;
  var incomingFolders = [];
  var selectedIncomingFolder = null;
  var incomingExistingEventId = null;
  var incomingCountryCode = null;
  var activeCountryFilterCode = null;
  var countryPickerSelectedCode = null;
  var countryPickerConfirmCallback = null;
  var countryPickerCancelCallback = null;
  var platformSettings = { siteMode: "travel", mapEnabled: true, eventsEnabled: true, tagsEnabled: true, countryFilterEnabled: true };
  var heroLayoutEnabled = false;
  var HERO_TILE_COUNT = 4;

  function initTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    var theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(theme);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "dark" ? "light" : "dark");
  }

  function adminFetch(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers, adminToken ? { "X-Admin-Token": adminToken } : {});
    return fetch(url, options).then(function (res) {
      if (res.status === 401) {
        adminToken = null;
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        exitAdminMode();
        window.alert("Přihlášení do administrace vypršelo. Zadejte PIN znovu.");
      }
      return res;
    });
  }

  var AUTO_FILL_FLOOR_TILE_SIZE = 40;

  function getCssDefaultTileSize() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue("--tile-size"), 10) || 140;
  }

  function applyTileSize(px) {
    document.documentElement.style.setProperty("--tile-size", px + "px");
  }

  function computeFillTileSize(photoCount) {
    var gallery = document.getElementById("gallery");
    if (!photoCount || !gallery) return getCssDefaultTileSize();

    var gap = 8;
    var galleryStyle = getComputedStyle(gallery);
    var containerWidth = gallery.clientWidth - parseFloat(galleryStyle.paddingLeft) - parseFloat(galleryStyle.paddingRight);
    if (!containerWidth) return getCssDefaultTileSize();

    var availableHeight = window.innerHeight - gallery.getBoundingClientRect().top - 32;
    if (availableHeight < 150) availableHeight = 150;

    // The grid uses minmax(tileSize, 1fr), so a column's rendered width - and by
    // extension its square tile's height - is whatever width n columns stretch to,
    // not the raw tileSize. Search nearby column counts for the one whose resulting
    // grid height comes closest to availableHeight without going over it.
    var estimate = Math.sqrt((photoCount * containerWidth) / availableHeight);
    var minCols = Math.max(1, Math.floor(estimate) - 1);
    var maxCols = Math.ceil(estimate) + 1;

    var fitting = null;
    var overflowing = null;

    for (var cols = minCols; cols <= maxCols; cols++) {
      var rows = Math.ceil(photoCount / cols);
      var tileSize = (containerWidth - gap * (cols - 1)) / cols;
      var totalHeight = rows * tileSize + gap * (rows - 1);

      if (totalHeight <= availableHeight) {
        if (!fitting || totalHeight > fitting.totalHeight) fitting = { cols: cols, totalHeight: totalHeight };
      } else if (!overflowing || totalHeight < overflowing.totalHeight) {
        overflowing = { cols: cols, totalHeight: totalHeight };
      }
    }

    var bestCols = fitting ? fitting.cols : overflowing.cols;
    // Floor (not round) and shave off a couple more px as slack, so real-device
    // subpixel/scrollbar rounding differences can't push the grid past the edge.
    var finalTileSize = Math.floor((containerWidth - gap * (bestCols - 1)) / bestCols) - 2;

    return Math.max(AUTO_FILL_FLOOR_TILE_SIZE, finalTileSize);
  }

  function applyTileSizeSliderBounds() {
    var slider = document.getElementById("tile-size-slider");
    var defaultSize = computeFillTileSize(currentPhotos.length);
    var maxSize = Math.max(defaultSize * 2, 400);
    slider.max = String(maxSize);

    var value = manualTileSize !== null ? Math.min(manualTileSize, maxSize) : defaultSize;
    slider.value = String(value);
    applyTileSize(value);
  }

  function updateAdminAuthHint() {
    document.getElementById("admin-toggle").classList.toggle("icon-btn--admin-authenticated", !!adminToken && !adminMode);
    document.getElementById("platform-config-toggle").classList.toggle("icon-btn--admin-authenticated", !!adminToken);
    document.getElementById("events-toggle").classList.toggle("icon-btn--admin-hint", !!adminToken);
    document.getElementById("events-add-btn").hidden = !adminToken;
    renderEventsList();
  }

  function hintLoginViaGear() {
    var gear = document.getElementById("platform-config-toggle");
    gear.classList.remove("icon-btn--shake");
    void gear.offsetWidth;
    gear.classList.add("icon-btn--shake");
  }

  function enterAdminMode() {
    adminMode = true;
    document.getElementById("dropzone").hidden = false;
    document.getElementById("admin-tools").hidden = false;
    document.getElementById("admin-toggle").classList.add("icon-btn--admin-on");
    document.getElementById("admin-toggle").setAttribute("aria-expanded", "true");
    document.getElementById("tile-size-toggle").disabled = true;
    document.getElementById("tile-size-panel").hidden = true;
    document.documentElement.style.removeProperty("--tile-size");
    updateAdminAuthHint();
    refreshDisplay();
  }

  function exitAdminMode() {
    adminMode = false;
    document.getElementById("dropzone").hidden = true;
    document.getElementById("admin-tools").hidden = true;
    document.getElementById("admin-toggle").classList.remove("icon-btn--admin-on");
    document.getElementById("admin-toggle").setAttribute("aria-expanded", "false");
    document.getElementById("tile-size-toggle").disabled = false;
    applyTileSizeSliderBounds();
    selectedIds.clear();
    updateBulkActions();
    updateAdminAuthHint();
    refreshDisplay();
  }

  function openAdminLogin() {
    document.getElementById("admin-pin-input").value = "";
    document.getElementById("admin-pin-error").hidden = true;
    document.getElementById("admin-login").hidden = false;
    document.getElementById("admin-pin-input").focus();
  }

  function closeAdminLogin() {
    document.getElementById("admin-login").hidden = true;
  }

  function submitAdminPin() {
    var pin = document.getElementById("admin-pin-input").value.trim();
    if (!pin) return;

    fetch("api/auth.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pin }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          document.getElementById("admin-pin-error").textContent = result.data.error || "Nesprávný PIN";
          document.getElementById("admin-pin-error").hidden = false;
          return;
        }
        adminToken = result.data.token;
        localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
        closeAdminLogin();
        updateAdminAuthHint();
      })
      .catch(function () {
        document.getElementById("admin-pin-error").textContent = "Ověření selhalo. Zkuste to prosím znovu.";
        document.getElementById("admin-pin-error").hidden = false;
      });
  }

  function initAdminLogin() {
    document.getElementById("admin-pin-cancel").addEventListener("click", closeAdminLogin);
    document.getElementById("admin-pin-submit").addEventListener("click", submitAdminPin);
    document.getElementById("admin-login").addEventListener("click", function (event) {
      if (event.target.id === "admin-login") closeAdminLogin();
    });
    document.getElementById("admin-pin-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter") submitAdminPin();
    });
  }

  var currentPhotos = [];

  function pluralizePhotos(count) {
    if (count === 1) return count + " fotka";
    if (count >= 2 && count <= 4) return count + " fotky";
    return count + " fotek";
  }

  function loadPhotos() {
    return fetch("api/photos.php", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Nepodařilo se načíst fotky");
        return res.json();
      })
      .then(function (photos) {
        currentPhotos = photos;
        document.getElementById("photo-count").textContent = pluralizePhotos(photos.length);
        if (!adminMode && !heroLayoutEnabled) {
          applyTileSizeSliderBounds();
        }
        renderCountryFilterList();
        refreshDisplay();
        if (!document.getElementById("map-view").hidden) refreshWorldMapHighlights();
      })
      .catch(function () {
        document.getElementById("gallery").innerHTML = "";
        document.getElementById("photo-count").textContent = "";
      });
  }

  function loadTags() {
    return fetch("api/tags.php", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Nepodařilo se načíst tagy");
        return res.json();
      })
      .then(function (tags) {
        allTags = tags;
        renderFilterChips();
      })
      .catch(function () {
        allTags = [];
        renderFilterChips();
      });
  }

  function loadEvents() {
    return fetch("api/events.php", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Nepodařilo se načíst akce");
        return res.json();
      })
      .then(function (events) {
        allEvents = events;
        renderEventsList();
      })
      .catch(function () {
        allEvents = [];
        renderEventsList();
      });
  }

  function loadPlatformSettings() {
    return fetch("api/settings.php", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Nepodařilo se načíst nastavení");
        return res.json();
      })
      .then(function (settings) {
        platformSettings = settings;
        applyPlatformSettings();
      })
      .catch(function () {
        applyPlatformSettings();
      });
  }

  function applyPlatformSettings() {
    var photoMode = platformSettings.siteMode === "photo";
    var mapOn = !photoMode && platformSettings.mapEnabled;
    var eventsOn = !photoMode && platformSettings.eventsEnabled;
    var tagsOn = !photoMode && platformSettings.tagsEnabled;
    var countryOn = !photoMode && platformSettings.countryFilterEnabled;

    document.getElementById("map-toggle").hidden = !mapOn;
    document.getElementById("events-toggle").closest(".filter-wrap").hidden = !eventsOn;
    document.getElementById("filter-toggle").closest(".filter-wrap").hidden = !tagsOn;
    document.getElementById("country-filter-toggle").closest(".filter-wrap").hidden = !countryOn;

    if (!mapOn && !document.getElementById("map-view").hidden) {
      closeMapView();
    }
    if (!eventsOn && activeEventFilterId) {
      resetAllFilters();
    }
    if (!tagsOn && activeFilterTagIds.size > 0) {
      resetAllFilters();
    }
    if (!countryOn && activeCountryFilterCode) {
      resetAllFilters();
    }

    if (photoMode !== heroLayoutEnabled) {
      heroLayoutEnabled = photoMode;
      if (!adminMode) {
        if (heroLayoutEnabled) {
          document.documentElement.style.removeProperty("--tile-size");
        } else {
          applyTileSizeSliderBounds();
        }
      }
    }
    refreshDisplay();
  }

  function getFilteredPhotos() {
    return currentPhotos.filter(function (photo) {
      var matchesTags =
        activeFilterTagIds.size === 0 ||
        (photo.tagIds || []).some(function (id) {
          return activeFilterTagIds.has(id);
        });
      var matchesEvent = !activeEventFilterId || photo.eventId === activeEventFilterId;
      var matchesCountry = !activeCountryFilterCode || photo.countryCode === activeCountryFilterCode;
      return matchesTags && matchesEvent && matchesCountry;
    });
  }

  function refreshDisplay() {
    renderGallery(getFilteredPhotos());
  }

  function applyExclusiveFilter(type, value) {
    activeFilterTagIds = new Set(type === "tag" ? [value] : []);
    activeEventFilterId = type === "event" ? value : null;
    activeCountryFilterCode = type === "country" ? value : null;

    document.getElementById("filter-toggle").classList.toggle("icon-btn--active", activeFilterTagIds.size > 0);
    renderFilterChips();
    renderEventsList();
    renderCountryFilterList();
    renderActiveFiltersBar();
    closeLightbox();
    refreshDisplay();
  }

  function resetAllFilters() {
    activeFilterTagIds = new Set();
    activeEventFilterId = null;
    activeCountryFilterCode = null;

    document.getElementById("filter-toggle").classList.remove("icon-btn--active");
    renderFilterChips();
    renderEventsList();
    renderCountryFilterList();
    renderActiveFiltersBar();
    refreshDisplay();
  }

  function renderActiveFiltersBar() {
    var bar = document.getElementById("active-filters-bar");
    var container = document.getElementById("active-filters-chips");
    container.innerHTML = "";

    var chips = [];

    activeFilterTagIds.forEach(function (tagId) {
      var tag = allTags.filter(function (t) {
        return t.id === tagId;
      })[0];
      if (!tag) return;
      chips.push({
        label: tag.name,
        onRemove: function () {
          activeFilterTagIds.delete(tagId);
          document.getElementById("filter-toggle").classList.toggle("icon-btn--active", activeFilterTagIds.size > 0);
          renderFilterChips();
          renderActiveFiltersBar();
          refreshDisplay();
        },
      });
    });

    if (activeEventFilterId) {
      var event = allEvents.filter(function (e) {
        return e.id === activeEventFilterId;
      })[0];
      if (event) {
        chips.push({
          label: event.name,
          onRemove: function () {
            activeEventFilterId = null;
            renderEventsList();
            renderActiveFiltersBar();
            refreshDisplay();
          },
        });
      }
    }

    if (activeCountryFilterCode) {
      chips.push({
        label: getCountryName(activeCountryFilterCode),
        onRemove: function () {
          activeCountryFilterCode = null;
          renderCountryFilterList();
          renderActiveFiltersBar();
          refreshDisplay();
        },
      });
    }

    bar.hidden = chips.length === 0;

    chips.forEach(function (chip) {
      var chipEl = document.createElement("button");
      chipEl.type = "button";
      chipEl.className = "tag-chip tag-chip--active";
      chipEl.textContent = chip.label + " ×";
      chipEl.addEventListener("click", chip.onRemove);
      container.appendChild(chipEl);
    });
  }

  function initActiveFiltersBar() {
    document.getElementById("active-filters-reset").addEventListener("click", resetAllFilters);
  }

  function renderGallery(photos) {
    var gallery = document.getElementById("gallery");
    gallery.innerHTML = "";
    var fragment = document.createDocumentFragment();

    photos.forEach(function (photo, index) {
      var tile = document.createElement("div");
      tile.className = "tile" + (heroLayoutEnabled && index < HERO_TILE_COUNT ? " tile--hero" : "");

      var openBtn = document.createElement("button");
      openBtn.className = "tile__open";
      openBtn.style.cssText = "position:absolute; inset:0; width:100%; height:100%; border:0; padding:0; background:transparent; cursor:pointer;";
      openBtn.setAttribute("aria-label", "Otevřít fotku " + (index + 1));

      var img = document.createElement("img");
      img.src = photo.thumbUrl;
      img.loading = "lazy";
      img.alt = "";
      openBtn.appendChild(img);

      openBtn.addEventListener("click", function () {
        if (adminMode) {
          toggleSelect(photo.id, tile);
          var cb = tile.querySelector(".tile__select");
          if (cb) cb.checked = selectedIds.has(photo.id);
          return;
        }
        openLightbox(photos, index);
      });

      tile.appendChild(openBtn);

      if (adminMode) {
        if (selectedIds.has(photo.id)) {
          tile.classList.add("tile--selected");
        }

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "tile__select";
        checkbox.setAttribute("aria-label", "Vybrat fotku " + (index + 1));
        checkbox.checked = selectedIds.has(photo.id);
        checkbox.addEventListener("click", function (event) {
          event.stopPropagation();
        });
        checkbox.addEventListener("change", function () {
          toggleSelect(photo.id, tile);
        });
        tile.appendChild(checkbox);

        var deleteBtn = document.createElement("button");
        deleteBtn.className = "icon-btn tile__delete";
        deleteBtn.setAttribute("aria-label", "Smazat fotku " + (index + 1));
        deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
        deleteBtn.addEventListener("click", function (event) {
          event.stopPropagation();
          deletePhoto(photo.id);
        });
        tile.appendChild(deleteBtn);
      }

      fragment.appendChild(tile);
    });

    gallery.appendChild(fragment);
  }

  function toggleSelect(id, tile) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      tile.classList.remove("tile--selected");
    } else {
      selectedIds.add(id);
      tile.classList.add("tile--selected");
    }
    updateBulkActions();
  }

  function clearSelection() {
    selectedIds.clear();
    updateBulkActions();
    refreshDisplay();
  }

  function selectAllVisible() {
    getFilteredPhotos().forEach(function (photo) {
      selectedIds.add(photo.id);
    });
    updateBulkActions();
    refreshDisplay();
  }

  function updateBulkActions() {
    var bar = document.getElementById("bulk-actions");
    var count = selectedIds.size;
    bar.hidden = count === 0;
    document.getElementById("bulk-count").textContent =
      count + " " + (count === 1 ? "vybraná fotka" : count < 5 ? "vybrané fotky" : "vybraných fotek");
  }

  function bulkDeletePhotos() {
    var ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm("Opravdu smazat " + ids.length + " fotek?")) return;

    adminFetch("api/delete.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          selectedIds.clear();
          updateBulkActions();
          loadPhotos();
        } else {
          window.alert("Smazání se nezdařilo: " + (result.data.error || "neznámá chyba"));
        }
      })
      .catch(function () {
        window.alert("Smazání se nezdařilo. Zkuste to prosím znovu.");
      });
  }

  function deletePhoto(id) {
    if (!window.confirm("Opravdu smazat tuto fotku?")) return;

    adminFetch("api/delete.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          if (!document.getElementById("lightbox").hidden) {
            closeLightbox();
          }
          loadPhotos();
        } else {
          window.alert("Smazání se nezdařilo: " + (result.data.error || "neznámá chyba"));
        }
      })
      .catch(function () {
        window.alert("Smazání se nezdařilo. Zkuste to prosím znovu.");
      });
  }

  var lightboxState = { photos: [], index: 0 };

  function openLightbox(photos, index) {
    lightboxState.photos = photos;
    lightboxState.index = index;
    updateLightboxImage();
    document.getElementById("lb-delete").hidden = !adminToken;
    document.getElementById("lightbox").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    document.getElementById("lightbox").hidden = true;
    document.body.style.overflow = "";
  }

  function showNext() {
    lightboxState.index = (lightboxState.index + 1) % lightboxState.photos.length;
    updateLightboxImage();
  }

  function showPrev() {
    lightboxState.index = (lightboxState.index - 1 + lightboxState.photos.length) % lightboxState.photos.length;
    updateLightboxImage();
  }

  function updateLightboxImage() {
    var photo = lightboxState.photos[lightboxState.index];
    document.getElementById("lb-image").src = photo.originalUrl;
    renderLightboxMeta(photo);
  }

  function renderLightboxMeta(photo) {
    var eventBtn = document.getElementById("lb-event");
    var countryBtn = document.getElementById("lb-country");
    var tagsContainer = document.getElementById("lb-tags");

    var event = photo.eventId
      ? allEvents.filter(function (e) {
          return e.id === photo.eventId;
        })[0]
      : null;

    if (event) {
      eventBtn.textContent = event.name;
      eventBtn.hidden = false;
      eventBtn.onclick = function () {
        applyExclusiveFilter("event", event.id);
      };
    } else {
      eventBtn.hidden = true;
      eventBtn.onclick = null;
    }

    if (photo.countryCode) {
      countryBtn.textContent = getCountryName(photo.countryCode);
      countryBtn.hidden = false;
      countryBtn.onclick = function () {
        applyExclusiveFilter("country", photo.countryCode);
      };
    } else {
      countryBtn.hidden = true;
      countryBtn.onclick = null;
    }

    tagsContainer.innerHTML = "";
    (photo.tagIds || []).forEach(function (tagId) {
      var tag = allTags.filter(function (t) {
        return t.id === tagId;
      })[0];
      if (!tag) return;

      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "lightbox__tag";
      chip.textContent = tag.name;
      chip.addEventListener("click", function () {
        applyExclusiveFilter("tag", tagId);
      });
      tagsContainer.appendChild(chip);
    });
  }

  function initLightboxControls() {
    document.getElementById("lb-close").addEventListener("click", closeLightbox);
    document.getElementById("lb-next").addEventListener("click", showNext);
    document.getElementById("lb-prev").addEventListener("click", showPrev);
    document.getElementById("lb-delete").addEventListener("click", function () {
      var photo = lightboxState.photos[lightboxState.index];
      deletePhoto(photo.id);
    });

    document.getElementById("lightbox").addEventListener("click", function (event) {
      if (event.target.id === "lightbox") {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key !== "Escape") {
        if (!document.getElementById("lightbox").hidden) {
          if (event.key === "ArrowRight") showNext();
          if (event.key === "ArrowLeft") showPrev();
        }
        return;
      }
      if (!document.getElementById("lightbox").hidden) closeLightbox();
      if (!document.getElementById("tag-picker").hidden) closeTagPicker();
      if (!document.getElementById("tag-manager").hidden) closeTagManager();
      if (!document.getElementById("filter-panel").hidden) document.getElementById("filter-panel").hidden = true;
      if (!document.getElementById("event-picker").hidden) closeEventPicker();
      if (!document.getElementById("event-editor").hidden) closeEventEditor();
      if (!document.getElementById("event-delete-modal").hidden) closeEventDeleteModal();
      if (!document.getElementById("events-panel").hidden) document.getElementById("events-panel").hidden = true;
      if (!document.getElementById("country-filter-panel").hidden) document.getElementById("country-filter-panel").hidden = true;
      if (!document.getElementById("country-picker").hidden) closeCountryPickerCancel();
      if (!document.getElementById("admin-login").hidden) closeAdminLogin();
      if (!document.getElementById("incoming-picker").hidden) closeIncomingPicker();
      if (!document.getElementById("delete-folders-modal").hidden) closeDeleteFoldersModal();
      if (!document.getElementById("tile-size-panel").hidden) {
        document.getElementById("tile-size-panel").hidden = true;
        document.getElementById("tile-size-toggle").setAttribute("aria-expanded", "false");
      }
    });
  }

  function setUploadStatus(text) {
    document.getElementById("upload-status").textContent = text;
  }

  function uploadFiles(files, countryCode) {
    if (files.length === 0) {
      setUploadStatus("Vyberte prosím obrázky.");
      return;
    }

    var formData = new FormData();
    files.forEach(function (file) {
      formData.append("photos[]", file);
    });
    if (countryCode) {
      formData.append("countryCode", countryCode);
    }

    setUploadStatus("Nahrávám " + files.length + " " + (files.length === 1 ? "fotku" : "fotek") + "...");

    adminFetch("api/upload.php", { method: "POST", body: formData })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        var uploadedCount = (result.data.uploaded || []).length;
        var errorCount = (result.data.errors || []).length;

        if (uploadedCount > 0) {
          setUploadStatus("Nahráno: " + uploadedCount + (errorCount ? ", chyby: " + errorCount : ""));
          loadPhotos();
        } else {
          setUploadStatus("Nahrávání se nezdařilo: " + (result.data.error || "neznámá chyba"));
        }
      })
      .catch(function () {
        setUploadStatus("Nahrávání se nezdařilo. Zkuste to prosím znovu.");
      });
  }

  function startUpload(fileList) {
    var files = Array.prototype.filter.call(fileList, function (file) {
      return file.type.indexOf("image/") === 0;
    });

    if (files.length === 0) {
      setUploadStatus("Vyberte prosím obrázky.");
      return;
    }

    openCountryPicker({
      title: "Jaké zemi fotky patří?",
      onConfirm: function (countryCode) {
        uploadFiles(files, countryCode);
      },
      onCancel: function () {
        setUploadStatus("");
      },
    });
  }

  function initUpload() {
    var dropzone = document.getElementById("dropzone");
    var fileInput = document.getElementById("file-input");

    document.getElementById("pick-files").addEventListener("click", function () {
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      if (fileInput.files.length > 0) {
        startUpload(fileInput.files);
        fileInput.value = "";
      }
    });

    ["dragenter", "dragover"].forEach(function (eventName) {
      dropzone.addEventListener(eventName, function (event) {
        event.preventDefault();
        dropzone.classList.add("dropzone--active");
      });
    });

    ["dragleave", "drop"].forEach(function (eventName) {
      dropzone.addEventListener(eventName, function (event) {
        event.preventDefault();
        dropzone.classList.remove("dropzone--active");
      });
    });

    dropzone.addEventListener("drop", function (event) {
      if (event.dataTransfer.files.length > 0) {
        startUpload(event.dataTransfer.files);
      }
    });

    var adminToggle = document.getElementById("admin-toggle");
    adminToggle.addEventListener("click", function () {
      if (adminMode) {
        exitAdminMode();
        return;
      }
      if (adminToken) {
        enterAdminMode();
      } else {
        hintLoginViaGear();
      }
    });

    document.getElementById("bulk-clear").addEventListener("click", clearSelection);
    document.getElementById("bulk-delete").addEventListener("click", bulkDeletePhotos);
    document.getElementById("bulk-tag").addEventListener("click", openTagPicker);
    document.getElementById("manage-tags-btn").addEventListener("click", openTagManager);
    document.getElementById("select-all-btn").addEventListener("click", selectAllVisible);
  }

  function renderFilterChips() {
    var container = document.getElementById("filter-tags");
    var empty = document.getElementById("filter-empty");
    container.innerHTML = "";
    empty.hidden = allTags.length > 0;

    allTags.forEach(function (tag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (activeFilterTagIds.has(tag.id) ? " tag-chip--active" : "");
      chip.textContent = tag.name;
      chip.addEventListener("click", function (event) {
        event.stopPropagation();
        if (activeFilterTagIds.has(tag.id)) {
          activeFilterTagIds.delete(tag.id);
        } else {
          activeFilterTagIds.add(tag.id);
        }
        document.getElementById("filter-toggle").classList.toggle("icon-btn--active", activeFilterTagIds.size > 0);
        renderFilterChips();
        renderActiveFiltersBar();
        refreshDisplay();
      });
      container.appendChild(chip);
    });
  }

  var filterPanelToggles = [];

  function registerFilterPanelToggle(toggle, panel) {
    filterPanelToggles.push({ toggle: toggle, panel: panel });
  }

  function closeOtherFilterPanels(currentPanel) {
    filterPanelToggles.forEach(function (entry) {
      if (entry.panel !== currentPanel && !entry.panel.hidden) {
        entry.panel.hidden = true;
        entry.toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function clampPanelToViewport(panel) {
    panel.style.transform = "";
    var margin = 8;
    var rect = panel.getBoundingClientRect();
    var overflowRight = rect.right - (window.innerWidth - margin);
    var overflowLeft = margin - rect.left;
    if (overflowRight > 0) {
      panel.style.transform = "translateX(-" + overflowRight + "px)";
    } else if (overflowLeft > 0) {
      panel.style.transform = "translateX(" + overflowLeft + "px)";
    }
  }

  function initFilter() {
    var filterToggle = document.getElementById("filter-toggle");
    var filterPanel = document.getElementById("filter-panel");
    registerFilterPanelToggle(filterToggle, filterPanel);

    filterToggle.addEventListener("click", function (event) {
      event.stopPropagation();
      var willOpen = filterPanel.hidden;
      if (willOpen) closeOtherFilterPanels(filterPanel);
      filterPanel.hidden = !willOpen;
      if (willOpen) clampPanelToViewport(filterPanel);
      filterToggle.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", function (event) {
      if (!filterPanel.hidden && !filterPanel.contains(event.target) && event.target !== filterToggle) {
        filterPanel.hidden = true;
        filterToggle.setAttribute("aria-expanded", "false");
      }
    });

    document.getElementById("filter-clear").addEventListener("click", function () {
      activeFilterTagIds.clear();
      filterToggle.classList.remove("icon-btn--active");
      renderFilterChips();
      renderActiveFiltersBar();
      refreshDisplay();
    });
  }

  function initTileSize() {
    var toggle = document.getElementById("tile-size-toggle");
    var panel = document.getElementById("tile-size-panel");
    var slider = document.getElementById("tile-size-slider");
    registerFilterPanelToggle(toggle, panel);

    applyTileSizeSliderBounds();

    slider.addEventListener("input", function () {
      var value = parseInt(slider.value, 10);
      manualTileSize = value;
      applyTileSize(value);
    });

    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      var willOpen = panel.hidden;
      if (willOpen) closeOtherFilterPanels(panel);
      panel.hidden = !willOpen;
      if (willOpen) clampPanelToViewport(panel);
      toggle.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  function updatePlatformConfigModeUI() {
    var isPhoto = document.getElementById("config-mode-photo").checked;
    document.getElementById("platform-config-mode-hint").hidden = !isPhoto;
    ["config-map-enabled", "config-events-enabled", "config-tags-enabled", "config-country-filter-enabled"].forEach(function (id) {
      var checkbox = document.getElementById(id);
      checkbox.disabled = isPhoto;
      checkbox.closest(".platform-config-option").classList.toggle("platform-config-option--disabled", isPhoto);
    });
  }

  function populatePlatformConfigForm() {
    document.getElementById("config-mode-travel").checked = platformSettings.siteMode !== "photo";
    document.getElementById("config-mode-photo").checked = platformSettings.siteMode === "photo";
    document.getElementById("config-map-enabled").checked = platformSettings.mapEnabled;
    document.getElementById("config-events-enabled").checked = platformSettings.eventsEnabled;
    document.getElementById("config-tags-enabled").checked = platformSettings.tagsEnabled;
    document.getElementById("config-country-filter-enabled").checked = platformSettings.countryFilterEnabled;
    document.getElementById("platform-config-status").hidden = true;
    updatePlatformConfigModeUI();
  }

  function savePlatformSettings() {
    var payload = {
      siteMode: document.getElementById("config-mode-photo").checked ? "photo" : "travel",
      mapEnabled: document.getElementById("config-map-enabled").checked,
      eventsEnabled: document.getElementById("config-events-enabled").checked,
      tagsEnabled: document.getElementById("config-tags-enabled").checked,
      countryFilterEnabled: document.getElementById("config-country-filter-enabled").checked,
    };
    var status = document.getElementById("platform-config-status");

    adminFetch("api/settings.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          status.textContent = result.data.error || "Uložení selhalo";
          status.hidden = false;
          return;
        }
        platformSettings = result.data;
        applyPlatformSettings();
        document.getElementById("platform-config-panel").hidden = true;
        document.getElementById("platform-config-toggle").setAttribute("aria-expanded", "false");
      })
      .catch(function () {
        status.textContent = "Uložení selhalo. Zkuste to prosím znovu.";
        status.hidden = false;
      });
  }

  function initPlatformConfigPanel() {
    var toggle = document.getElementById("platform-config-toggle");
    var panel = document.getElementById("platform-config-panel");
    registerFilterPanelToggle(toggle, panel);

    toggle.addEventListener("click", function (event) {
      if (!adminToken) {
        openAdminLogin();
        return;
      }
      event.stopPropagation();
      var willOpen = panel.hidden;
      if (willOpen) closeOtherFilterPanels(panel);
      panel.hidden = !willOpen;
      if (willOpen) {
        populatePlatformConfigForm();
        clampPanelToViewport(panel);
      }
      toggle.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    document.getElementById("platform-config-save").addEventListener("click", savePlatformSettings);

    document.getElementById("config-mode-travel").addEventListener("change", updatePlatformConfigModeUI);
    document.getElementById("config-mode-photo").addEventListener("change", updatePlatformConfigModeUI);
  }

  function renderTagPickerChips() {
    var container = document.getElementById("tag-picker-list");
    var empty = document.getElementById("tag-picker-empty");
    container.innerHTML = "";
    empty.hidden = allTags.length > 0;

    allTags.forEach(function (tag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (tagPickerSelection.has(tag.id) ? " tag-chip--active" : "");
      chip.textContent = tag.name;
      chip.addEventListener("click", function () {
        if (tagPickerSelection.has(tag.id)) {
          tagPickerSelection.delete(tag.id);
        } else {
          tagPickerSelection.add(tag.id);
        }
        renderTagPickerChips();
      });
      container.appendChild(chip);
    });
  }

  function openTagPicker() {
    tagPickerSelection = new Set();
    renderTagPickerChips();
    document.getElementById("tag-picker-input").value = "";
    document.getElementById("tag-picker").hidden = false;
  }

  function closeTagPicker() {
    document.getElementById("tag-picker").hidden = true;
  }

  function createTag(name) {
    return adminFetch("api/tags.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", name: name }),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  function initTagPicker() {
    document.getElementById("tag-picker-cancel").addEventListener("click", closeTagPicker);

    document.getElementById("tag-picker").addEventListener("click", function (event) {
      if (event.target.id === "tag-picker") closeTagPicker();
    });

    document.getElementById("tag-picker-add").addEventListener("click", function () {
      var input = document.getElementById("tag-picker-input");
      var name = input.value.trim();
      if (!name) return;

      createTag(name).then(function (result) {
        if (!result.ok) {
          window.alert("Vytvoření tagu selhalo: " + (result.data.error || "neznámá chyba"));
          return;
        }
        allTags.push(result.data);
        tagPickerSelection.add(result.data.id);
        renderTagPickerChips();
        renderFilterChips();
        input.value = "";
      });
    });

    document.getElementById("tag-picker-apply").addEventListener("click", function () {
      var tagIds = Array.from(tagPickerSelection);
      if (tagIds.length === 0) {
        window.alert("Vyberte alespoň jeden tag.");
        return;
      }

      adminFetch("api/photo-tags.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selectedIds), tagIds: tagIds }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            window.alert("Přiřazení tagů selhalo: " + (result.data.error || "neznámá chyba"));
            return;
          }
          closeTagPicker();
          selectedIds.clear();
          updateBulkActions();
          loadPhotos();
        })
        .catch(function () {
          window.alert("Přiřazení tagů selhalo. Zkuste to prosím znovu.");
        });
    });
  }

  function renderTagManagerList() {
    var container = document.getElementById("tag-manager-list");
    var empty = document.getElementById("tag-manager-empty");
    container.innerHTML = "";
    empty.hidden = allTags.length > 0;

    allTags.forEach(function (tag) {
      var row = document.createElement("div");
      row.className = "tag-manager-row";

      var input = document.createElement("input");
      input.type = "text";
      input.className = "input";
      input.value = tag.name;

      var saveBtn = document.createElement("button");
      saveBtn.className = "icon-btn";
      saveBtn.setAttribute("aria-label", "Uložit název tagu");
      saveBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>';
      saveBtn.addEventListener("click", function () {
        var newName = input.value.trim();
        if (!newName || newName === tag.name) return;

        adminFetch("api/tags.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "rename", id: tag.id, name: newName }),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              window.alert("Přejmenování selhalo: " + (result.data.error || "neznámá chyba"));
              return;
            }
            tag.name = newName;
            renderFilterChips();
          });
      });

      var deleteBtn = document.createElement("button");
      deleteBtn.className = "icon-btn";
      deleteBtn.setAttribute("aria-label", "Smazat tag " + tag.name);
      deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
      deleteBtn.addEventListener("click", function () {
        if (!window.confirm('Opravdu smazat tag "' + tag.name + '"? Odebere se ze všech fotek.')) return;

        adminFetch("api/tags.php", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", id: tag.id }),
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (!result.ok) {
              window.alert("Smazání tagu selhalo: " + (result.data.error || "neznámá chyba"));
              return;
            }
            allTags = allTags.filter(function (t) {
              return t.id !== tag.id;
            });
            activeFilterTagIds.delete(tag.id);
            renderTagManagerList();
            renderFilterChips();
            renderActiveFiltersBar();
            loadPhotos();
          });
      });

      row.appendChild(input);
      row.appendChild(saveBtn);
      row.appendChild(deleteBtn);
      container.appendChild(row);
    });
  }

  function openTagManager() {
    renderTagManagerList();
    document.getElementById("tag-manager-input").value = "";
    document.getElementById("tag-manager").hidden = false;
  }

  function closeTagManager() {
    document.getElementById("tag-manager").hidden = true;
  }

  function initTagManager() {
    document.getElementById("tag-manager-close").addEventListener("click", closeTagManager);

    document.getElementById("tag-manager").addEventListener("click", function (event) {
      if (event.target.id === "tag-manager") closeTagManager();
    });

    document.getElementById("tag-manager-add").addEventListener("click", function () {
      var input = document.getElementById("tag-manager-input");
      var name = input.value.trim();
      if (!name) return;

      createTag(name).then(function (result) {
        if (!result.ok) {
          window.alert("Vytvoření tagu selhalo: " + (result.data.error || "neznámá chyba"));
          return;
        }
        allTags.push(result.data);
        renderTagManagerList();
        renderFilterChips();
        input.value = "";
      });
    });
  }

  function formatEventDate(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    return parseInt(parts[2], 10) + ". " + parseInt(parts[1], 10) + ". " + parts[0];
  }

  function formatEventRange(startDate, endDate) {
    var start = formatEventDate(startDate);
    if (!endDate || endDate === startDate) return start;
    return start + " – " + formatEventDate(endDate);
  }

  function getEventPhotoCounts() {
    var counts = {};
    currentPhotos.forEach(function (photo) {
      if (!photo.eventId) return;
      counts[photo.eventId] = (counts[photo.eventId] || 0) + 1;
    });
    return counts;
  }

  function pluralizeEvents(count) {
    if (count === 1) return count + " akci";
    if (count >= 2 && count <= 4) return count + " akce";
    return count + " akcí";
  }

  function updateEventsBulkActionsUI() {
    var bar = document.getElementById("events-bulk-actions");
    bar.hidden = !adminToken || allEvents.length === 0;

    var allSelected = allEvents.length > 0 && selectedEventIds.size === allEvents.length;
    document.getElementById("events-select-all-btn").textContent = allSelected ? "zrušit výběr" : "vybrat vše";

    var deleteBtn = document.getElementById("events-bulk-delete-btn");
    deleteBtn.disabled = selectedEventIds.size === 0;
    deleteBtn.textContent = selectedEventIds.size > 0 ? "smazat vybrané (" + selectedEventIds.size + ")" : "smazat vybrané";
  }

  function renderEventsList() {
    var container = document.getElementById("events-list");
    var empty = document.getElementById("events-empty");
    var counts = getEventPhotoCounts();
    container.innerHTML = "";
    empty.hidden = allEvents.length > 0;
    container.hidden = allEvents.length === 0;

    var validIds = new Set(allEvents.map(function (evt) { return evt.id; }));
    selectedEventIds.forEach(function (id) {
      if (!validIds.has(id)) selectedEventIds.delete(id);
    });
    updateEventsBulkActionsUI();

    allEvents.forEach(function (evt) {
      var row = document.createElement("div");
      row.className = "event-row";

      if (adminToken) {
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "event-row__checkbox";
        checkbox.setAttribute("aria-label", "Vybrat akci " + evt.name);
        checkbox.checked = selectedEventIds.has(evt.id);
        checkbox.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        checkbox.addEventListener("change", function () {
          if (checkbox.checked) {
            selectedEventIds.add(evt.id);
          } else {
            selectedEventIds.delete(evt.id);
          }
          updateEventsBulkActionsUI();
        });
        row.appendChild(checkbox);
      }

      var selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "event-row__select" + (activeEventFilterId === evt.id ? " event-row__select--active" : "");
      selectBtn.innerHTML =
        '<span class="event-row__name"></span><span class="event-row__dates"></span>';
      selectBtn.querySelector(".event-row__name").textContent = evt.name + " (" + (counts[evt.id] || 0) + ")";
      selectBtn.querySelector(".event-row__dates").textContent = formatEventRange(evt.startDate, evt.endDate);
      selectBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        activeEventFilterId = activeEventFilterId === evt.id ? null : evt.id;
        renderEventsList();
        renderActiveFiltersBar();
        refreshDisplay();
        document.getElementById("events-panel").hidden = true;
        document.getElementById("events-toggle").setAttribute("aria-expanded", "false");
      });
      row.appendChild(selectBtn);

      if (adminToken) {
        var editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "icon-btn";
        editBtn.setAttribute("aria-label", "Upravit akci " + evt.name);
        editBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
        editBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          openEventEditor(evt);
        });
        row.appendChild(editBtn);

        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "icon-btn";
        deleteBtn.setAttribute("aria-label", "Smazat akci " + evt.name);
        deleteBtn.innerHTML =
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
        deleteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          deleteEvent(evt.id, evt.name);
        });
        row.appendChild(deleteBtn);
      }

      container.appendChild(row);
    });
  }

  var pendingDeleteEventIds = null;

  function deleteEvent(id, name) {
    pendingDeleteEventIds = [id];
    document.getElementById("event-delete-modal-text").textContent = 'Opravdu smazat akci "' + name + '"?';
    document.getElementById("event-delete-modal").hidden = false;
  }

  function bulkDeleteEvents() {
    if (selectedEventIds.size === 0) return;
    pendingDeleteEventIds = Array.from(selectedEventIds);
    document.getElementById("event-delete-modal-text").textContent =
      "Opravdu smazat " + pluralizeEvents(pendingDeleteEventIds.length) + "?";
    document.getElementById("event-delete-modal").hidden = false;
  }

  function closeEventDeleteModal() {
    pendingDeleteEventIds = null;
    document.getElementById("event-delete-modal").hidden = true;
  }

  function confirmDeleteEvent(deletePhotos) {
    var ids = pendingDeleteEventIds;
    if (!ids || !ids.length) return;
    closeEventDeleteModal();

    adminFetch("api/events.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", ids: ids, deletePhotos: deletePhotos }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          window.alert("Smazání akce selhalo: " + (result.data.error || "neznámá chyba"));
          return;
        }
        ids.forEach(function (id) {
          if (activeEventFilterId === id) activeEventFilterId = null;
          selectedEventIds.delete(id);
        });
        renderActiveFiltersBar();
        loadEvents();
        loadPhotos();
      });
  }

  function openEventEditor(evt) {
    editingEventId = evt ? evt.id : null;
    document.getElementById("event-editor-title").textContent = evt ? "Upravit akci" : "Přidat akci";
    document.getElementById("event-name").value = evt ? evt.name : "";
    document.getElementById("event-location").value = evt ? evt.location || "" : "";
    document.getElementById("event-description").value = evt ? evt.description || "" : "";
    document.getElementById("event-participants").value = evt ? evt.participants || "" : "";
    document.getElementById("event-start").value = evt ? evt.startDate : "";

    var dateMode = !!(evt && evt.endDate);
    document.querySelector('input[name="event-end-mode"][value="' + (dateMode ? "date" : "days") + '"]').checked = true;
    document.getElementById("event-days").value = "1";
    document.getElementById("event-end").value = evt && evt.endDate ? evt.endDate : "";
    updateEventEndModeVisibility();

    document.getElementById("event-editor").hidden = false;
  }

  function closeEventEditor() {
    document.getElementById("event-editor").hidden = true;
  }

  function updateEventEndModeVisibility() {
    var mode = document.querySelector('input[name="event-end-mode"]:checked').value;
    document.getElementById("event-days").hidden = mode !== "days";
    document.getElementById("event-end").hidden = mode !== "date";
  }

  function saveEvent() {
    var name = document.getElementById("event-name").value.trim();
    var startDate = document.getElementById("event-start").value;
    if (!name || !startDate) {
      window.alert("Vyplňte prosím jméno a začátek akce.");
      return;
    }

    var endMode = document.querySelector('input[name="event-end-mode"]:checked').value;
    var payload = {
      action: editingEventId ? "update" : "create",
      id: editingEventId,
      name: name,
      location: document.getElementById("event-location").value.trim(),
      description: document.getElementById("event-description").value.trim(),
      participants: document.getElementById("event-participants").value.trim(),
      startDate: startDate,
      endMode: endMode,
      days: document.getElementById("event-days").value,
      endDate: document.getElementById("event-end").value,
    };

    adminFetch("api/events.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          window.alert("Uložení akce selhalo: " + (result.data.error || "neznámá chyba"));
          return;
        }
        closeEventEditor();
        loadEvents();
      });
  }

  function initEventEditor() {
    document.getElementById("events-add-btn").addEventListener("click", function () {
      openEventEditor(null);
    });
    document.getElementById("event-editor-cancel").addEventListener("click", closeEventEditor);
    document.getElementById("event-editor-save").addEventListener("click", saveEvent);
    document.getElementById("event-editor").addEventListener("click", function (event) {
      if (event.target.id === "event-editor") closeEventEditor();
    });

    document.getElementById("event-delete-cancel").addEventListener("click", closeEventDeleteModal);
    document.getElementById("event-delete-keep-photos").addEventListener("click", function () {
      confirmDeleteEvent(false);
    });
    document.getElementById("event-delete-with-photos").addEventListener("click", function () {
      confirmDeleteEvent(true);
    });
    document.getElementById("event-delete-modal").addEventListener("click", function (event) {
      if (event.target.id === "event-delete-modal") closeEventDeleteModal();
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="event-end-mode"]'), function (radio) {
      radio.addEventListener("change", updateEventEndModeVisibility);
    });
  }

  function renderEventPickerList() {
    var container = document.getElementById("event-picker-list");
    var empty = document.getElementById("event-picker-empty");
    container.innerHTML = "";
    empty.hidden = allEvents.length > 0;

    allEvents.forEach(function (evt) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (eventPickerSelectedId === evt.id ? " tag-chip--active" : "");
      chip.textContent = evt.name;
      chip.addEventListener("click", function () {
        eventPickerSelectedId = eventPickerSelectedId === evt.id ? null : evt.id;
        renderEventPickerList();
      });
      container.appendChild(chip);
    });
  }

  function openEventPicker() {
    eventPickerSelectedId = null;
    renderEventPickerList();
    document.getElementById("event-picker").hidden = false;
  }

  function closeEventPicker() {
    document.getElementById("event-picker").hidden = true;
  }

  function initEventPicker() {
    document.getElementById("bulk-event").addEventListener("click", openEventPicker);
    document.getElementById("event-picker-cancel").addEventListener("click", closeEventPicker);
    document.getElementById("event-picker").addEventListener("click", function (event) {
      if (event.target.id === "event-picker") closeEventPicker();
    });

    document.getElementById("event-picker-apply").addEventListener("click", function () {
      if (!eventPickerSelectedId) {
        window.alert("Vyberte akci.");
        return;
      }

      adminFetch("api/photo-events.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selectedIds), eventId: eventPickerSelectedId }),
      })
        .then(function (res) {
          return res.json().then(function (data) {
            return { ok: res.ok, data: data };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            window.alert("Přiřazení akce selhalo: " + (result.data.error || "neznámá chyba"));
            return;
          }
          closeEventPicker();
          selectedIds.clear();
          updateBulkActions();
          loadPhotos();
        })
        .catch(function () {
          window.alert("Přiřazení akce selhalo. Zkuste to prosím znovu.");
        });
    });
  }

  function initEventsPanel() {
    var eventsToggle = document.getElementById("events-toggle");
    var eventsPanel = document.getElementById("events-panel");
    registerFilterPanelToggle(eventsToggle, eventsPanel);

    eventsToggle.addEventListener("click", function (event) {
      event.stopPropagation();
      var willOpen = eventsPanel.hidden;
      if (willOpen) closeOtherFilterPanels(eventsPanel);
      eventsPanel.hidden = !willOpen;
      if (willOpen) clampPanelToViewport(eventsPanel);
      eventsToggle.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", function (event) {
      if (!eventsPanel.hidden && !eventsPanel.contains(event.target) && event.target !== eventsToggle) {
        eventsPanel.hidden = true;
        eventsToggle.setAttribute("aria-expanded", "false");
      }
    });

    document.getElementById("events-select-all-btn").addEventListener("click", function (event) {
      event.stopPropagation();
      var allSelected = allEvents.length > 0 && selectedEventIds.size === allEvents.length;
      if (allSelected) {
        selectedEventIds.clear();
      } else {
        allEvents.forEach(function (evt) {
          selectedEventIds.add(evt.id);
        });
      }
      renderEventsList();
    });

    document.getElementById("events-bulk-delete-btn").addEventListener("click", function (event) {
      event.stopPropagation();
      bulkDeleteEvents();
    });
  }

  function getCountryName(code) {
    var country = window.COUNTRIES.filter(function (c) {
      return c.code === code;
    })[0];
    return country ? country.name : code;
  }

  function getUsedCountries() {
    var counts = getCountryPhotoCounts();
    var list = Object.keys(counts).map(function (code) {
      return { code: code, name: getCountryName(code), count: counts[code] };
    });
    list.sort(function (a, b) {
      return a.name.localeCompare(b.name, "cs");
    });
    return list;
  }

  function renderCountryFilterList() {
    var container = document.getElementById("country-filter-list");
    var empty = document.getElementById("country-filter-empty");
    var countries = getUsedCountries();
    container.innerHTML = "";
    empty.hidden = countries.length > 0;
    container.hidden = countries.length === 0;

    countries.forEach(function (country) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "event-row__select" + (activeCountryFilterCode === country.code ? " event-row__select--active" : "");
      btn.textContent = country.name + " (" + country.count + ")";
      btn.addEventListener("click", function (event) {
        event.stopPropagation();
        activeCountryFilterCode = activeCountryFilterCode === country.code ? null : country.code;
        renderCountryFilterList();
        renderActiveFiltersBar();
        refreshDisplay();
        document.getElementById("country-filter-panel").hidden = true;
        document.getElementById("country-filter-toggle").setAttribute("aria-expanded", "false");
      });
      container.appendChild(btn);
    });
  }

  function initCountryFilterPanel() {
    var toggle = document.getElementById("country-filter-toggle");
    var panel = document.getElementById("country-filter-panel");
    registerFilterPanelToggle(toggle, panel);

    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      var willOpen = panel.hidden;
      if (willOpen) closeOtherFilterPanels(panel);
      panel.hidden = !willOpen;
      if (willOpen) clampPanelToViewport(panel);
      toggle.setAttribute("aria-expanded", String(willOpen));
    });

    document.addEventListener("click", function (event) {
      if (!panel.hidden && !panel.contains(event.target) && event.target !== toggle) {
        panel.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      }
    });

  }

  function getCountryPhotoCounts() {
    var counts = {};
    currentPhotos.forEach(function (photo) {
      if (!photo.countryCode) return;
      counts[photo.countryCode] = (counts[photo.countryCode] || 0) + 1;
    });
    return counts;
  }

  function buildWorldMap() {
    var container = document.getElementById("world-map");
    var data = window.WORLD_MAP;
    var svgNs = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 " + data.width + " " + data.height);

    Object.keys(data.paths).forEach(function (code) {
      var path = document.createElementNS(svgNs, "path");
      path.setAttribute("d", data.paths[code]);
      path.setAttribute("class", "world-map__country");
      path.setAttribute("data-code", code);
      var title = document.createElementNS(svgNs, "title");
      path.appendChild(title);
      svg.appendChild(path);
    });

    svg.addEventListener("click", function (event) {
      var code = event.target.getAttribute("data-code");
      if (!code || !event.target.classList.contains("world-map__country--active")) return;
      applyExclusiveFilter("country", activeCountryFilterCode === code ? null : code);
      closeMapView();
    });

    container.innerHTML = "";
    container.appendChild(svg);
  }

  function refreshWorldMapHighlights() {
    var counts = getCountryPhotoCounts();
    var paths = document.querySelectorAll("#world-map .world-map__country");
    paths.forEach(function (path) {
      var code = path.getAttribute("data-code");
      var count = counts[code] || 0;
      var isActive = count > 0;
      path.classList.toggle("world-map__country--active", isActive);
      path.classList.toggle("world-map__country--selected", activeCountryFilterCode === code);
      var title = path.querySelector("title");
      title.textContent = isActive
        ? getCountryName(code) + " (" + count + (count === 1 ? " fotka" : count < 5 ? " fotky" : " fotek") + ")"
        : getCountryName(code);
    });
  }

  function openMapView() {
    closeOtherFilterPanels({});
    if (!document.getElementById("world-map").firstChild) buildWorldMap();
    refreshWorldMapHighlights();
    document.getElementById("gallery").hidden = true;
    document.getElementById("active-filters-bar").hidden = true;
    document.getElementById("map-view").hidden = false;
    document.getElementById("map-toggle").classList.add("icon-btn--active");
    document.getElementById("map-toggle").setAttribute("aria-expanded", "true");
  }

  function closeMapView() {
    document.getElementById("map-view").hidden = true;
    document.getElementById("gallery").hidden = false;
    document.getElementById("map-toggle").classList.remove("icon-btn--active");
    document.getElementById("map-toggle").setAttribute("aria-expanded", "false");
    renderActiveFiltersBar();
    if (!adminMode) applyTileSizeSliderBounds();
  }

  function initMapView() {
    document.getElementById("map-toggle").addEventListener("click", function () {
      var isOpen = !document.getElementById("map-view").hidden;
      if (isOpen) {
        closeMapView();
      } else {
        openMapView();
      }
    });
  }

  function renderCountryPickerList(query) {
    var container = document.getElementById("country-picker-list");
    container.innerHTML = "";
    var q = query.trim().toLowerCase();
    var list = window.COUNTRIES.filter(function (c) {
      return !q || c.name.toLowerCase().indexOf(q) !== -1;
    });

    list.forEach(function (c) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (countryPickerSelectedCode === c.code ? " tag-chip--active" : "");
      chip.textContent = c.name;
      chip.addEventListener("click", function () {
        countryPickerSelectedCode = c.code;
        renderCountryPickerList(document.getElementById("country-picker-search").value);
      });
      container.appendChild(chip);
    });
  }

  function openCountryPicker(options) {
    countryPickerConfirmCallback = options.onConfirm || null;
    countryPickerCancelCallback = options.onCancel || null;
    countryPickerSelectedCode = options.initialCode || null;
    document.getElementById("country-picker-title").textContent = options.title || "Vybrat zemi";
    document.getElementById("country-picker-search").value = "";
    renderCountryPickerList("");
    document.getElementById("country-picker").hidden = false;
    document.getElementById("country-picker-search").focus();
  }

  function closeCountryPickerCancel() {
    document.getElementById("country-picker").hidden = true;
    var callback = countryPickerCancelCallback;
    countryPickerConfirmCallback = null;
    countryPickerCancelCallback = null;
    if (callback) callback();
  }

  function closeCountryPickerConfirm(code) {
    document.getElementById("country-picker").hidden = true;
    var callback = countryPickerConfirmCallback;
    countryPickerConfirmCallback = null;
    countryPickerCancelCallback = null;
    if (callback) callback(code);
  }

  function initCountryPicker() {
    document.getElementById("country-picker-search").addEventListener("input", function () {
      renderCountryPickerList(this.value);
    });
    document.getElementById("country-picker-cancel").addEventListener("click", closeCountryPickerCancel);
    document.getElementById("country-picker-skip").addEventListener("click", function () {
      closeCountryPickerConfirm(null);
    });
    document.getElementById("country-picker-apply").addEventListener("click", function () {
      if (!countryPickerSelectedCode) {
        window.alert('Vyberte zemi, nebo zvolte "bez země".');
        return;
      }
      closeCountryPickerConfirm(countryPickerSelectedCode);
    });
    document.getElementById("country-picker").addEventListener("click", function (event) {
      if (event.target.id === "country-picker") closeCountryPickerCancel();
    });
  }

  function initBulkCountry() {
    document.getElementById("bulk-country").addEventListener("click", function () {
      openCountryPicker({
        title: "Přiřadit zemi vybraným fotkám",
        onConfirm: function (countryCode) {
          adminFetch("api/photo-countries.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoIds: Array.from(selectedIds), countryCode: countryCode }),
          })
            .then(function (res) {
              return res.json().then(function (data) {
                return { ok: res.ok, data: data };
              });
            })
            .then(function (result) {
              if (!result.ok) {
                window.alert("Přiřazení země selhalo: " + (result.data.error || "neznámá chyba"));
                return;
              }
              selectedIds.clear();
              updateBulkActions();
              loadPhotos();
            });
        },
      });
    });
  }

  function loadIncomingFolders() {
    return adminFetch("api/incoming.php", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Nepodařilo se načíst složky");
        return res.json();
      })
      .then(function (folders) {
        incomingFolders = folders;
        renderIncomingList();
      })
      .catch(function () {
        incomingFolders = [];
        renderIncomingList();
      });
  }

  function renderIncomingList() {
    var container = document.getElementById("incoming-list");
    var empty = document.getElementById("incoming-empty");
    container.innerHTML = "";
    empty.hidden = incomingFolders.length > 0;

    incomingFolders.forEach(function (folder) {
      var row = document.createElement("div");
      row.className = "event-row";

      var selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className =
        "event-row__select" + (selectedIncomingFolder === folder.name ? " event-row__select--active" : "");
      selectBtn.innerHTML = '<span class="event-row__name"></span><span class="event-row__dates"></span>';
      selectBtn.querySelector(".event-row__name").textContent = folder.name;
      selectBtn.querySelector(".event-row__dates").textContent = folder.count + " fotek";
      selectBtn.addEventListener("click", function () {
        selectedIncomingFolder = folder.name;
        document.getElementById("incoming-event-name").value = folder.name;
        document.getElementById("incoming-event-section").hidden = false;
        setIncomingImportButtonState(false);
        renderIncomingList();
      });
      row.appendChild(selectBtn);
      container.appendChild(row);
    });
  }

  function renderIncomingExistingEvents() {
    var container = document.getElementById("incoming-event-existing");
    var empty = document.getElementById("incoming-event-existing-empty");
    container.innerHTML = "";
    empty.hidden = allEvents.length > 0;

    allEvents.forEach(function (evt) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (incomingExistingEventId === evt.id ? " tag-chip--active" : "");
      chip.textContent = evt.name;
      chip.addEventListener("click", function () {
        incomingExistingEventId = incomingExistingEventId === evt.id ? null : evt.id;
        renderIncomingExistingEvents();
      });
      container.appendChild(chip);
    });
  }

  function updateIncomingEventModeVisibility() {
    var mode = document.querySelector('input[name="incoming-event-mode"]:checked').value;
    document.getElementById("incoming-event-name").hidden = mode !== "new";
    document.getElementById("incoming-event-start").hidden = mode !== "new";
    document.getElementById("incoming-event-existing").hidden = mode !== "existing";
    document.getElementById("incoming-event-existing-empty").hidden = mode !== "existing" || allEvents.length > 0;
  }

  function setIncomingImportButtonState(succeeded) {
    var btn = document.getElementById("incoming-import");
    btn.textContent = succeeded ? "zavřít" : "importovat";
    btn.dataset.done = succeeded ? "1" : "";
  }

  function updateIncomingCountryButtonLabel() {
    var btn = document.getElementById("incoming-country-btn");
    btn.textContent = incomingCountryCode ? getCountryName(incomingCountryCode) : "vybrat zemi";
  }

  function openIncomingPicker() {
    selectedIncomingFolder = null;
    incomingExistingEventId = null;
    incomingCountryCode = null;
    document.getElementById("incoming-event-section").hidden = true;
    document.getElementById("incoming-event-name").value = "";
    document.getElementById("incoming-event-start").value = new Date().toISOString().slice(0, 10);
    document.querySelector('input[name="incoming-event-mode"][value="new"]').checked = true;
    document.getElementById("incoming-delete-originals").checked = true;
    document.getElementById("incoming-status").hidden = true;
    setIncomingImportButtonState(false);
    renderIncomingExistingEvents();
    updateIncomingEventModeVisibility();
    updateIncomingCountryButtonLabel();
    document.getElementById("incoming-picker").hidden = false;
    loadIncomingFolders();
  }

  function closeIncomingPicker() {
    document.getElementById("incoming-picker").hidden = true;
  }

  function submitIncomingImport() {
    if (!selectedIncomingFolder) {
      window.alert("Vyberte složku k importu.");
      return;
    }

    var eventMode = document.querySelector('input[name="incoming-event-mode"]:checked').value;
    var deleteOriginals = document.getElementById("incoming-delete-originals").checked;
    var payload = {
      folder: selectedIncomingFolder,
      eventMode: eventMode,
      deleteOriginals: deleteOriginals,
      countryCode: incomingCountryCode,
    };

    if (eventMode === "new") {
      payload.eventName = document.getElementById("incoming-event-name").value.trim();
      payload.eventStartDate = document.getElementById("incoming-event-start").value;
      if (!payload.eventName || !payload.eventStartDate) {
        window.alert("Vyplňte prosím název a datum nové akce.");
        return;
      }
    } else if (eventMode === "existing") {
      if (!incomingExistingEventId) {
        window.alert("Vyberte existující akci.");
        return;
      }
      payload.eventId = incomingExistingEventId;
    }

    var statusEl = document.getElementById("incoming-status");
    statusEl.hidden = false;
    statusEl.className = "form-error";
    statusEl.textContent = "Importuji...";

    adminFetch("api/import-incoming.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          statusEl.className = "form-error";
          statusEl.textContent = result.data.error || "Import selhal";
          return;
        }
        statusEl.className = "form-error form-status--ok";
        statusEl.textContent =
          "Importováno: " +
          result.data.imported +
          (result.data.skipped.length ? ", přeskočeno: " + result.data.skipped.length : "");
        selectedIncomingFolder = null;
        document.getElementById("incoming-event-section").hidden = true;
        setIncomingImportButtonState(true);
        loadIncomingFolders();
        loadEvents();
        loadPhotos();
      })
      .catch(function () {
        statusEl.className = "form-error";
        statusEl.textContent = "Import selhal. Zkuste to prosím znovu.";
      });
  }

  function initIncomingPicker() {
    document.getElementById("import-btn").addEventListener("click", openIncomingPicker);
    document.getElementById("incoming-cancel").addEventListener("click", closeIncomingPicker);
    document.getElementById("incoming-country-btn").addEventListener("click", function () {
      openCountryPicker({
        title: "Jaké zemi fotky patří?",
        initialCode: incomingCountryCode,
        onConfirm: function (countryCode) {
          incomingCountryCode = countryCode;
          updateIncomingCountryButtonLabel();
        },
      });
    });
    document.getElementById("incoming-import").addEventListener("click", function () {
      if (document.getElementById("incoming-import").dataset.done === "1") {
        closeIncomingPicker();
        return;
      }
      submitIncomingImport();
    });
    document.getElementById("incoming-picker").addEventListener("click", function (event) {
      if (event.target.id === "incoming-picker") closeIncomingPicker();
    });
    Array.prototype.forEach.call(document.querySelectorAll('input[name="incoming-event-mode"]'), function (radio) {
      radio.addEventListener("change", updateIncomingEventModeVisibility);
    });
  }

  function loadDeleteFolders() {
    var statusEl = document.getElementById("delete-folders-status");
    return adminFetch("api/incoming.php", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Nepodařilo se načíst složky");
        return res.json();
      })
      .then(function (folders) {
        renderDeleteFoldersList(folders);
      })
      .catch(function () {
        renderDeleteFoldersList([]);
        statusEl.hidden = false;
        statusEl.className = "form-error";
        statusEl.textContent = "Nepodařilo se načíst složky.";
      });
  }

  function renderDeleteFoldersList(folders) {
    var container = document.getElementById("delete-folders-list");
    var empty = document.getElementById("delete-folders-empty");
    container.innerHTML = "";
    empty.hidden = folders.length > 0;

    folders.forEach(function (folder) {
      var row = document.createElement("div");
      row.className = "event-row";

      var label = document.createElement("span");
      label.className = "event-row__select";
      label.innerHTML = '<span class="event-row__name"></span><span class="event-row__dates"></span>';
      label.querySelector(".event-row__name").textContent = folder.name;
      label.querySelector(".event-row__dates").textContent = folder.count + " fotek";
      row.appendChild(label);

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn";
      deleteBtn.setAttribute("aria-label", "Smazat adresář " + folder.name);
      deleteBtn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>';
      deleteBtn.addEventListener("click", function () {
        deleteIncomingFolder(folder.name);
      });
      row.appendChild(deleteBtn);

      container.appendChild(row);
    });
  }

  function deleteIncomingFolder(name) {
    if (!window.confirm('Opravdu smazat adresář "' + name + '" a všechny fotky v něm z FTP?')) return;

    var statusEl = document.getElementById("delete-folders-status");
    statusEl.hidden = true;

    adminFetch("api/incoming-delete.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: name }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) {
          statusEl.hidden = false;
          statusEl.className = "form-error";
          statusEl.textContent = result.data.error || "Smazání adresáře selhalo";
          return;
        }
        loadDeleteFolders();
      });
  }

  function openDeleteFoldersModal() {
    document.getElementById("delete-folders-status").hidden = true;
    document.getElementById("delete-folders-modal").hidden = false;
    loadDeleteFolders();
  }

  function closeDeleteFoldersModal() {
    document.getElementById("delete-folders-modal").hidden = true;
  }

  function initDeleteFoldersModal() {
    document.getElementById("delete-folders-btn").addEventListener("click", openDeleteFoldersModal);
    document.getElementById("delete-folders-close").addEventListener("click", closeDeleteFoldersModal);
    document.getElementById("delete-folders-modal").addEventListener("click", function (event) {
      if (event.target.id === "delete-folders-modal") closeDeleteFoldersModal();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initTheme();
    updateAdminAuthHint();
    document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
    initLightboxControls();
    initUpload();
    initFilter();
    initTileSize();
    initTagPicker();
    initTagManager();
    initEventsPanel();
    initEventEditor();
    initEventPicker();
    initCountryFilterPanel();
    initMapView();
    initCountryPicker();
    initBulkCountry();
    initActiveFiltersBar();
    initAdminLogin();
    initIncomingPicker();
    initDeleteFoldersModal();
    initPlatformConfigPanel();
    loadPlatformSettings().then(function () {
      if (platformSettings.siteMode !== "photo" && platformSettings.mapEnabled) openMapView();
    });
    loadPhotos();
    loadTags();
    loadEvents();
  });
})();
