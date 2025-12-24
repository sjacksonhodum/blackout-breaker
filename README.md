# blackout breaker

🔗 **[Try it now: https://sjacksonhodum.github.io/blackout-breaker/](https://sjacksonhodum.github.io/blackout-breaker/)**

A web-based tool for viewing redacted PDFs (mainly yk what) with the redactions removed. Upload any PDF with black box redactions and see them highlighted and removed in a side-by-side view.

![Blackout Breaker](https://img.shields.io/badge/Status-Active-success)
![License](https://img.shields.io/badge/License-MIT-blue)

## Features

- **PDF Upload**: Upload single PDFs or entire folders
- **Redaction Detection**: Automatically detects black box redactions
- **Split View**: Side-by-side comparison of original and fixed versions
- **Synchronized Scrolling**: Both panes scroll together
- **Diff View**: List of all detected redactions with "Jump to" buttons (similar to github)
- **Download Fixed**: Save the version with redactions removed
- **Fixed Tag**: Documents you've saved are marked as "Fixed" in the sidebar
- **Dark Theme**: Modern GitHub-inspired interface

## How It Works
1. **Upload** - Click "Upload PDF" or drag and drop a PDF file
2. **Detect** - The app scans for black rectangular regions (redactions)
3. **View** - See the original with redactions highlighted on the left, and the cleaned version on the right
4. **Navigate** - Use the Diff View to jump to specific redactions
5. **Download** - Save the fixed version with redactions removed

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` / `→` | Previous / Next page |
| `S` | Switch to Split View |
| `D` | Switch to Diff View |

## Technologies Used

- **PDF.js** - Mozilla's PDF rendering library
- **Font Awesome** - Icons
- **Vanilla JavaScript** - No framework dependencies

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Limitations

- Redaction detection works best with solid black rectangles
- Complex redaction patterns may not be fully detected

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request



---

<p align="center">
  <strong>blackout breaker</strong> - revealing what was hidden
</p>
