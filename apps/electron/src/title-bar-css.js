const MAC_TRAFFIC_LIGHTS_CLEARANCE_PX = 88;

const TITLE_BAR_PADDING_CSS = `
  /* Only push the left sidebar nav down by 38px to clear macOS traffic lights.
     The right column (topbar + content) stays at its natural position. */
  .shell-nav {
    padding-top: 38px !important;
  }
  /* Mobile: .shell-nav becomes position: fixed — use top offset instead. */
  @media (max-width: 1100px) {
    .shell-nav {
      top: 38px !important;
      padding-top: 0 !important;
    }
    /* The drawer breakpoint moves the topbar to the window's left edge.
       Keep its hamburger and breadcrumb clear of the native traffic lights. */
    .topbar {
      padding-left: ${MAC_TRAFFIC_LIGHTS_CLEARANCE_PX}px !important;
    }
  }
  /* .shell-nav is already positioned by the dashboard at every breakpoint. */
  .shell-nav::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 38px;
    -webkit-app-region: drag;
    z-index: 100;
    pointer-events: auto;
  }
  /* Let the main top bar move the frameless window while its controls remain interactive. */
  .topbar {
    -webkit-app-region: drag;
  }
  .topbar button,
  .topbar a,
  .topbar input,
  .topbar select,
  .topbar textarea,
  .topbar [role="button"],
  .topbar [contenteditable="true"] {
    -webkit-app-region: no-drag;
  }
`;

module.exports = { MAC_TRAFFIC_LIGHTS_CLEARANCE_PX, TITLE_BAR_PADDING_CSS };
