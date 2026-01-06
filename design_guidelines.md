# Sales Ops + Commissions Platform Design Guidelines

## Design Approach

**Selected System:** Carbon Design System + Linear-inspired UI  
**Rationale:** Enterprise data management requires clarity, scalability, and efficiency. Carbon excels at information-dense interfaces while Linear's modern aesthetic ensures the app feels contemporary, not dated.

**Design Principles:**
1. Data clarity over decoration
2. Role-based visual hierarchy (REP/MANAGER/ADMIN interfaces subtly differentiated)
3. Instant comprehension of commission status and financial states
4. Scalable component system that works for 5 or 500 reps

---

## Core Design Elements

### Typography
- **Primary Font:** Inter (Google Fonts)
- **Monospace Font:** JetBrains Mono (for financial figures, IDs)
- **Hierarchy:**
  - Page Headers: text-2xl font-semibold
  - Section Headers: text-lg font-medium
  - Data Labels: text-sm font-medium text-gray-700
  - Body/Table Text: text-sm font-normal
  - Financial Figures: font-mono text-base font-semibold
  - Metadata/Timestamps: text-xs text-gray-500

### Layout System
**Spacing Units:** Use Tailwind's 2, 4, 6, 8, 12, 16, 24 scale consistently
- Component padding: p-4 to p-6
- Section spacing: space-y-8 to space-y-12
- Card gaps: gap-4 to gap-6
- Page margins: max-w-7xl mx-auto px-6

---

## Component Library

### Navigation
**Top Bar (Fixed):**
- Company logo/name (left)
- Global search bar (center, prominent)
- User menu with role badge, notifications, settings (right)
- Height: h-16 with border-b

**Sidebar (Collapsible):**
- Width: w-64 (expanded), w-16 (collapsed)
- Sticky navigation with icons + labels
- Sections: Dashboard, Orders, Commissions, Teams (MANAGER+), Reports, QuickBooks Sync (ADMIN), Audit Log (ADMIN)
- Active state: Subtle left border accent + background tint

### Dashboard Components

**Stats Cards (Grid: grid-cols-1 md:grid-cols-2 lg:grid-cols-4):**
- Title: text-sm font-medium uppercase tracking-wide
- Value: text-3xl font-bold font-mono
- Subtext: text-xs with trend indicator (↑/↓)
- Padding: p-6, rounded-lg, border

**Commission Status Indicators:**
Use clear, color-coded badges:
- Earned: Checkmark icon + "Earned"
- Paid: Dollar icon + "Paid" + date
- Pending: Clock icon + "Pending Approval"
- Chargeback: Alert icon + "Chargeback"
Badge style: inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold

**Data Tables:**
- Sticky header row with sort indicators
- Zebra striping (subtle): odd rows with slight background tint
- Row hover: cursor-pointer with background highlight
- Financial columns: Right-aligned, font-mono
- Action column: Right-aligned with icon buttons
- Pagination: Bottom-right, showing "X-Y of Z entries"
- Dense mode: text-sm with py-3 row height

### Forms & Inputs
**Standard Input:**
- Height: h-10
- Border: border rounded-md
- Focus: ring-2 ring-offset-1
- Labels: text-sm font-medium mb-1.5

**Select Dropdowns:**
Identical styling to inputs with chevron icon

**Date Pickers:**
Calendar icon (right), clear button when populated

**Multi-select (Teams/Reps):**
Tag-based with dismiss X buttons

### Modals & Overlays
**Modal Container:**
- Max width: max-w-2xl for forms, max-w-4xl for detail views
- Padding: p-6
- Header: text-xl font-semibold mb-6
- Footer: Flex justify-end gap-3 with Cancel + Primary action

**Slide-over Panel (Detail Views):**
- Right-side panel: w-1/2 to w-2/3
- For viewing order/commission details without leaving context
- Close button (top-right), scrollable content area

### Financial Display Components
**Commission Breakdown Card:**
- Base Commission row
- Incentives/Bonuses (itemized)
- Upline Overrides (if applicable)
- Deductions/Chargebacks
- Horizontal divider before Total
- Total: Larger font-mono font-bold

**QuickBooks Reconciliation View:**
Split-pane design:
- Left: Internal records (Orders table)
- Right: QuickBooks import data
- Center: Match/Unmatch controls
- Matched items: Checkmark with linked reference
- Discrepancies: Warning icon + diff amount highlighted

---

## Page-Specific Layouts

### Dashboard (Role-Based)
**REP View:**
- Personal stats cards (4-col grid): MTD Earnings, Pending, Paid, Outstanding
- Recent orders table (last 10)
- Commission trend chart (area chart, 12-month view)

**MANAGER View:**
- Team overview stats (total team earnings, top performers)
- Team member grid/cards with individual stats
- Approval queue (prominent, action-required styling)

**ADMIN View:**
- Company-wide metrics (multi-row stat cards)
- System health indicators (QuickBooks sync status, pending approvals count)
- Quick actions panel (Run Reports, Export Data, Audit Log)

### Orders List
- Filter bar (top): Job Status, Approval Status, Date Range, Rep (MANAGER+)
- Table with sortable columns: Order#, Rep, Customer, Job Status, Approval, Amount, Earned Date, Paid Date
- Bulk actions: Approve Selected (MANAGER+), Export
- Click row → Slide-over with full order details + audit trail

### Audit Log (ADMIN Only)
- Timeline view with date grouping
- Each entry: Timestamp, User (with role badge), Action, Table, Record ID, Changes (diff view)
- Filterable by: User, Action Type, Date Range, Table

---

## Icons
**Library:** Heroicons (via CDN)  
**Usage:**
- Navigation: outline style, 20px
- Buttons: solid style, 16px
- Status indicators: mini style, 16px
- Data tables: outline style, 18px

---

## Responsive Behavior
- **Desktop (lg+):** Full sidebar + multi-column layouts
- **Tablet (md):** Collapsible sidebar, 2-column grids become 1-column
- **Mobile (base):** Bottom nav bar, stacked cards, horizontal-scroll tables with sticky first column

---

## Images
**Hero Image:** None (utility app, no marketing landing)  
**Application Images:**
- Empty states: Simple illustrations (use CDN service like unDraw)
- User avatars: Initials-based colored circles (generated from name)
- No decorative imagery in data views