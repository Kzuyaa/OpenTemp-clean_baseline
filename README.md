# OpenTemp — Clean Baseline Template

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Zero Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen?style=flat-square)

Bu repository, **OpenTemp** ile üretilmiş bir web template'idir. Tam CSS değişken sistemi, 13+ değiştirilebilir tema ve dashboard üzerinden inline editing desteği içerir.

---

## OpenTemp Nedir?

**OpenTemp**, HTML template'lerini yönetmek ve özelleştirmek için geliştirilmiş çift dilli (C++17 + Vanilla JS) bir template engine'dir.

```
OpenTemp
├── C++17 CLI          → Batch işleme, tema üretimi, template refactor
└── Vanilla JS Dashboard → Canlı önizleme, inline editor, export
```

Bu template, OpenTemp'in **Clean Baseline** formatını takip eder:
- Tüm renkler CSS değişkenleri (`--accent-vivid`, `--bg-main` vb.) üzerinden yönetilir
- Her element benzersiz bir `id` taşır — DOM çakışması yoktur
- Düzenlenebilir tüm elementler `.ot-editable-candidate` class'ını taşır

---

## Dosya Yapısı

```
clean_baseline/
├── index.html       → Template — {{placeholder}} sistemi ile içerik alanları
├── style.css        → Template stilleri + CSS değişken fallback'leri
└── template.json    → Dashboard field tanımları (id, type, label, default, targetSelector)
```

### `template.json` Nasıl Çalışır?

Her alan şu formatta tanımlanır:

```json
{
  "id": "st-title",
  "type": "text",
  "label": "Main Heading",
  "default": "Built to Last.",
  "targetSelector": "#st-title"
}
```

OpenTemp dashboard bu dosyayı okuyarak ilgili `targetSelector`'a canlı olarak içerik yazar.

---

## Temalar

Template 13 hazır CSS temasıyla çalışır. Tema değiştirmek için sadece `<link>` tag'ini swap et:

```html
<!-- Örnek: Clean SaaS (default) -->
<link rel="stylesheet" href="themes/theme-clean-saas.css">

<!-- Örnek: Obsidian Dark -->
<link rel="stylesheet" href="themes/theme-obsidian.css">
```

| Tema | Stil |
|---|---|
| `theme-clean-saas` | Minimal, açık — varsayılan |
| `theme-obsidian` | Ultra-dark, monokromatik |
| `theme-cyberpunk` | Neon, yüksek kontrast |
| `theme-nature` | Yumuşak, organik |
| `theme-cosmic` | Derin uzay, mor tonlar |
| `theme-gothic` | Koyu, dramatik |
| + 7 tema daha | ... |

---

## Önizleme

Template'i önizlemek için `index.html`'i doğrudan tarayıcıda aç veya VS Code Live Server kullan.

> **Not:** `{{texts.st_badge}}` gibi placeholder'lar OpenTemp dashboard yüklendiğinde `template.json`'daki `default` değerleriyle otomatik dolar.

---

## Teknik Detaylar

| Özellik | Detay |
|---|---|
| CSS mimari | Tamamen `var()` tabanlı — tema değişimi O(1) |
| ID protokolü | `st-` prefix, tüm elementler benzersiz |
| JS dependency | Sıfır — saf HTML/CSS |
| Export | OpenTemp dashboard üzerinden ZIP veya tek HTML |

---

*OpenTemp Engine — [github.com/Kzuyaa/OpenTemp-clean_baseline](https://github.com/Kzuyaa/OpenTemp-clean_baseline)*
