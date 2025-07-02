export function gettimepoints(code, tp) {
    fetch(`${window.location.origin}/api/gettimepoints?code=${code}`)
      .then((response) => response.json())
      .then((timepoints) => {
        filltimepoints(timepoints, code, tp);
      });
  }
  
  function filltimepoints(timepoints, code, tp) {
    const photoslist = document.querySelector(".nav");
    if (!photoslist) {
      // No navigation element found - likely in iframe content mode
      console.log('Navigation element not found - skipping timepoints navigation');
      return;
    }
    photoslist.innerHTML = ""; // Clear existing content to avoid duplication
  
    // Add timepoints from the fetched data
    if (timepoints) {
      timepoints.forEach((timepoint) => {
        addTab(
          photoslist,
          `${timepoint.tpDescription} ${formatDate(timepoint.tpDateTime)}`,
          `grid?code=${code}&tp=${timepoint.tpCode}`,
          timepoint.tpCode === tp
        );
      });
    }
  
    // Add static tabs
    const staticTabs = [
      { label: "Compare", href: `canvas?code=${code}`, id: "compare" },
      { label: "X-rays", href: `xrays?code=${code}`, id: "xrays" },
      { label: "Visit Summary", href: `visits-summary?PID=${code}`, id: "visitsSummary" },
      { label: "Payments", href: `payments?code=${code}`, id: "payments" },
      { label: "Home", href: "/", id: "home" },
    ];
  
    staticTabs.forEach((tab) => {
      addTab(photoslist, tab.label, tab.href, tab.id === tp);
    });
  }
  
  // Helper function to add a tab
  function addTab(container, label, href, isSelected) {
    const tpitem = document.createElement("li");
    const alink = document.createElement("a");
    alink.textContent = label;
    alink.setAttribute("href", href);
    if (isSelected) {
      alink.className = "selectedTP";
    }
    tpitem.appendChild(alink);
    container.appendChild(tpitem);
  }
  
  // Helper function to format the date
  function formatDate(dateTime) {
    return dateTime.substring(0, 10).split("-").reverse().join("-");
  }
  