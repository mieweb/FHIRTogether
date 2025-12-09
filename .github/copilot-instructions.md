## Code Quality Principles

<!-- https://github.com/mieweb/template-mieweb-opensource/blob/main/.github/copilot-instructions.md -->

## FHIRTogether Project Overview

This is a **FHIR-compliant scheduling gateway** built with:
- **TypeScript** + **Fastify** for the REST API server
- **SQLite3** (better-sqlite3) as the default pluggable backend store
- **OpenAPI 3.1 / Swagger UI** for API documentation
- **FHIR R4** resource types: Schedule, Slot, Appointment

### Project Structure
```
src/
├── types/fhir.ts          # FHIR resource type definitions & FhirStore interface
├── store/sqliteStore.ts   # SQLite3 backend implementation
├── routes/
│   ├── scheduleRoutes.ts  # /Schedule endpoints
│   ├── slotRoutes.ts      # /Slot endpoints
│   └── appointmentRoutes.ts # /Appointment endpoints
├── examples/
│   ├── generateBusyOffice.ts # Test data generator
│   └── README.md
└── server.ts              # Main Fastify server entry point
```

### Key Commands
- `npm run dev` - Start development server (port 4010)
- `npm run generate-data` - Generate busy office test data
- `npm run build` - Compile TypeScript
- `npm start` - Run production build

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/Schedule` | Provider schedule management |
| GET/POST | `/Slot` | Time slot availability |
| GET/POST | `/Appointment` | Appointment booking |
| GET | `/health` | Health check |
| GET | `/docs` | Swagger UI |

### FHIR Compliance
- All responses follow FHIR R4 Bundle format for searches
- Resource types: Schedule, Slot, Appointment
- Use proper FHIR references (e.g., `Schedule/123`, `Slot/456`)

### 🎯 DRY (Don't Repeat Yourself)
- **Never duplicate code**: If you find yourself copying code, extract it into a reusable function
- **Single source of truth**: Each piece of knowledge should have one authoritative representation
- **Refactor mercilessly**: When you see duplication, eliminate it immediately
- **Shared utilities**: Common patterns should be abstracted into utility functions

### 💋 KISS (Keep It Simple, Stupid)
- **Simple solutions**: Prefer the simplest solution that works
- **Avoid over-engineering**: Don't add complexity for hypothetical future needs
- **Clear naming**: Functions and variables should be self-documenting
- **Small functions**: Break down complex functions into smaller, focused ones
- **Readable code**: Code should be obvious to understand at first glance

### 🧹 Folder Philosophy
- **Clear purpose**: Every folder should have a main thing that anchors its contents.
- **No junk drawers**: Don’t leave loose files without context or explanation.
- **Explain relationships**: If it’s not elegantly obvious how files fit together, add a README or note.
- **Immediate clarity**: Opening a folder should make its organizing principle clear at a glance.

### 🔄 Refactoring Guidelines
- **Continuous improvement**: Refactor as you work, not as a separate task
- **Safe refactoring**: Always run tests before and after refactoring
- **Incremental changes**: Make small, safe changes rather than large rewrites
- **Preserve behavior**: Refactoring should not change external behavior
- **Code reviews**: All refactoring should be reviewed for correctness

### ⚰️ Dead Code Management
- **Immediate removal**: Delete unused code immediately when identified
- **Historical preservation**: Move significant dead code to `.attic/` directory with context
- **Documentation**: Include comments explaining why code was moved to attic
- **Regular cleanup**: Review and clean attic directory periodically
- **No accumulation**: Don't let dead code accumulate in active codebase

## HTML & CSS Guidelines
- **Semantic Naming**: Every `<div>` and other structural element must use a meaningful, semantic class name that clearly indicates its purpose or role within the layout.
- **CSS Simplicity**: Styles should avoid global resets or overrides that affect unrelated components or default browser behavior. Keep changes scoped and minimal.
- **SASS-First Approach**: All styles should be written in SASS (SCSS) whenever possible. Each component should have its own dedicated SASS file to promote modularity and maintainability.

## Accessibility (ARIA Labeling)

### 🎯 Interactive Elements
- **All interactive elements** (buttons, links, forms, dialogs) must include appropriate ARIA roles and labels
- **Use ARIA attributes**: Implement aria-label, aria-labelledby, and aria-describedby to provide clear, descriptive information for screen readers
- **Semantic HTML**: Use semantic HTML wherever possible to enhance accessibility

### 📢 Dynamic Content
- **Announce updates**: Ensure all dynamic content updates (modals, alerts, notifications) are announced to assistive technologies using aria-live regions
- **Maintain tab order**: Maintain logical tab order and keyboard navigation for all features
- **Visible focus**: Provide visible focus indicators for all interactive elements

## Internationalization (I18N)

### 🌍 Text and Language Support
- **Externalize text**: All user-facing text must be externalized for translation
- **Multiple languages**: Support multiple languages, including right-to-left (RTL) languages such as Arabic and Hebrew
- **Language selector**: Provide a language selector for users to choose their preferred language

### 🕐 Localization
- **Format localization**: Ensure date, time, number, and currency formats are localized based on user settings
- **UI compatibility**: Test UI layouts for text expansion and RTL compatibility
- **Unicode support**: Use Unicode throughout to support international character sets

## Documentation Preferences

### Diagrams and Visual Documentation
- **Always use Mermaid diagrams** instead of ASCII art for workflow diagrams, architecture diagrams, and flowcharts
- **Use memorable names** instead of single letters in diagrams (e.g., `Engine`, `Auth`, `Server` instead of `A`, `B`, `C`)
- Use appropriate Mermaid diagram types:
  - `graph TB` or `graph LR` for workflow architectures 
  - `flowchart TD` for process flows
  - `sequenceDiagram` for API interactions
  - `gitgraph` for branch/release strategies
- Include styling with `classDef` for better visual hierarchy
- Add descriptive comments and emojis sparingly for clarity

### Documentation Standards
- Keep documentation DRY (Don't Repeat Yourself) - reference other docs instead of duplicating
- Use clear cross-references between related documentation files
- Update the main architecture document when workflow structure changes

## Working with GitHub Actions Workflows

### Development Philosophy
- **Script-first approach**: All workflows should call scripts that can be run locally
- **Local development parity**: Developers should be able to run the exact same commands locally as CI runs
- **Simple workflows**: GitHub Actions should be thin wrappers around scripts, not contain complex logic
- **Easy debugging**: When CI fails, developers can reproduce the issue locally by running the same script

## Quick Reference

### 🪶 All Changes should be considered for Pull Request Philosophy

* **Smallest viable change**: Always make the smallest change that fully solves the problem.
* **Fewest files first**: Start with the minimal number of files required.
* **No sweeping edits**: Broad refactors or multi-module changes must be split or proposed as new components.
* **Isolated improvements**: If a change grows complex, extract it into a new function, module, or component instead of modifying multiple areas.
* **Direct requests only**: Large refactors or architectural shifts should only occur when explicitly requested.

### Code Quality Checklist
- [ ] **DRY**: No code duplication - extracted reusable functions?
- [ ] **KISS**: Simplest solution that works?
- [ ] **Minimal Changes**: Smallest viable change made for PR?
- [ ] **Naming**: Self-documenting function/variable names?
- [ ] **Size**: Functions small and focused?
- [ ] **Dead Code**: Removed or archived appropriately?
- [ ] **Accessibility**: ARIA labels and semantic HTML implemented?
- [ ] **I18N**: User-facing text externalized for translation?
- [ ] **Lint**: Run linter if appropriate
- [ ] **Test**: Run tests

## FHIRTogether-Specific Guidelines

### Store Implementation
- All database backends must implement the `FhirStore` interface in `src/types/fhir.ts`
- Use the SQLite store (`src/store/sqliteStore.ts`) as a reference implementation
- Always use parameterized queries to prevent SQL injection
- JSON fields (actors, participants, etc.) are stored as serialized strings

### Route Implementation
- All FHIR endpoints must return proper Bundle format for searches
- Response schemas must include `additionalProperties: true` to avoid Fastify stripping response data
- Use consistent error responses: `{ error: 'message' }` with appropriate HTTP status codes
- Test endpoints (DELETE operations) should check `ENABLE_TEST_ENDPOINTS` env var

### Data Generation
- The `generateBusyOffice.ts` script creates realistic test data
- Providers are configured with different specialties and appointment durations
- Data becomes stale after 30 days - regenerate with `npm run generate-data`
- Default fill rate is 75% to simulate a busy practice

### Environment Configuration
- All config via `.env` file (copy from `.env.example`)
- `PORT` - Server port (default: 4010)
- `STORE_BACKEND` - Database backend (default: sqlite)
- `SQLITE_DB_PATH` - Database file location
- `ENABLE_TEST_ENDPOINTS` - Enable DELETE operations