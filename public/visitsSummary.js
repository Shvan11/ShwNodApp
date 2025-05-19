const urlParams = new URLSearchParams(window.location.search);
const PID = urlParams.get("PID");
const apiUrl = `${window.location.origin}/api/visitsSummary?PID=${PID}`;
import { gettimepoints } from "./module.js";
let wireOptions = [];

window.onload = function () {
    gettimepoints(PID, "visitsSummary"); 
};

document.getElementById('showAddBtn').onclick = openAddVisitModal;
document.getElementsByClassName("close")[0].onclick = closeModal;
window.onclick = function (event) {
    if (event.target == document.getElementById("addVisitModal")) {
        closeModal();
    }
};



const updateVisitButton = document.getElementById('updateVisitButton');
const addVisitButton = document.getElementById('addVisitButton');
updateVisitButton.addEventListener('click', handleUpdateVisit);

async function fetchAndDisplayVisitsSummary() {
    try {
        const response = await fetch(apiUrl);
        const data = await response.json();

        const container = document.getElementById("visitsSummary");
        container.innerHTML = ''; // Clear existing content

        const table = document.createElement("table");

        const headerRow = document.createElement("tr");
        const headers = ["Visit Date", "Summary", "Actions"];
        headers.forEach(header => {
            const th = document.createElement("th");
            th.textContent = header;
            headerRow.appendChild(th);
        });
        table.appendChild(headerRow);

        data.forEach(visit => {
            const row = document.createElement("tr");

            const visitDateCell = document.createElement("td");
            visitDateCell.textContent = new Date(visit.VisitDate).toLocaleDateString();
            row.appendChild(visitDateCell);

            const summaryCell = document.createElement("td");
            summaryCell.innerHTML = visit.Summary;
            row.appendChild(summaryCell);

            const actionCell = document.createElement("td");
            const editButton = document.createElement("button");
            editButton.textContent = "Edit";
            editButton.addEventListener("click", () => openEditModal(visit.ID));
            actionCell.appendChild(editButton);

            const deleteButton = document.createElement("button");
            deleteButton.textContent = "Delete";
            deleteButton.addEventListener("click", () => deleteVisit(visit.ID));
            actionCell.appendChild(deleteButton);

            row.appendChild(actionCell);
            table.appendChild(row);
        });

        container.appendChild(table);
    } catch (error) {
        console.error("Error fetching visits summary data:", error);
    }
}

function closeModal() {
    document.getElementById("addVisitModal").style.display = "none";
}

async function openAddVisitModal() {


    const modal = document.getElementById("addVisitModal");
    const form = document.getElementById("visitForm");

    form.reset();
    document.getElementById('visitDate').value = new Date().toISOString().substring(0, 10);

    if (wireOptions.length === 0) {
        await fetchAndCacheWireOptions();
    }

    const latestwireURL = `${window.location.origin}/api/getLatestwire?PID=${PID}`;
    const response = await fetch(latestwireURL);
    const latestWire = await response.json();
    console.log(latestWire);
    if (latestWire.upperWireID) {
        document.getElementById('upperWire').value = latestWire.upperWireID;
    }
    if (latestWire.lowerWireID) {
        document.getElementById('lowerWire').value = latestWire.lowerWireID;
    }

    updateVisitButton.style.display = 'none'; // Hide the "Update Visit" button
    addVisitButton.style.display = 'inline-block'; // Show the "Add Visit" button
    addVisitButton.onclick = handleAddVisit;
    //form.onsubmit = handleAddVisit; // Add the "Add Visit" button functionality
    modal.style.display = "block";
}

async function openEditModal(ID) {

    const modal = document.getElementById("addVisitModal");
    const getVisitDetailsUrl = `${window.location.origin}/api/getVisitDetailsByID?VID=${ID}`;
    const response = await fetch(getVisitDetailsUrl);
    const visit = await response.json();
    document.getElementById('VID').value = ID;
    document.getElementById('visitDate').value = new Date(visit.visitDate).toISOString().slice(0, 10);
    document.getElementById('others').value = visit.others;
    document.getElementById('next').value = visit.next;

    if (wireOptions.length === 0) {
        await fetchAndCacheWireOptions();
    }

    setSelectedWireOption('upperWire', visit.upperWireID);
    setSelectedWireOption('lowerWire', visit.lowerWireID);



    updateVisitButton.style.display = 'inline-block'; // Show the "Update Visit" button
    addVisitButton.style.display = 'none'; // Hide the "Add Visit" button
    //document.getElementById('visitForm').onsubmit = handleUpdateVisit;
    modal.style.display = "block";
}

function setSelectedWireOption(selectId, wireId) {
    const select = document.getElementById(selectId);
    Array.from(select.options).forEach(option => {
        option.selected = option.value == wireId;
    });
}

async function deleteVisit(visitID) {
    const deleteVisitUrl = `${window.location.origin}/api/deleteVisit`;
    try {
        const response = await fetch(deleteVisitUrl, {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ VID: visitID })
        });
        const data = await response.json();

        if (data.status === 'success') {
            alert("Visit deleted successfully!");


            fetchAndDisplayVisitsSummary();
        } else {
            alert("Error deleting visit.");

        }
    } catch (error) {
        console.error("Error deleting visit:", error);
        alert("Error deleting visit.");

    }
}

async function fetchAndCacheWireOptions() {
    try {
        const response = await fetch('/api/getWires');
        wireOptions = await response.json();
        populateWireOptions();
    } catch (error) {
        console.error('Error fetching wire options:', error);
    }
}

function populateWireOptions() {
    const upperWireSelect = document.getElementById('upperWire');
    const lowerWireSelect = document.getElementById('lowerWire');

    const addPlaceholderOption = (select) => {
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.text = 'Select Wire';
        select.add(placeholderOption);
    };

    upperWireSelect.innerHTML = '';
    lowerWireSelect.innerHTML = '';
    addPlaceholderOption(upperWireSelect);
    addPlaceholderOption(lowerWireSelect);

    wireOptions.forEach(wire => {
        const upperOption = new Option(wire.name, wire.id);
        upperWireSelect.add(upperOption);

        const lowerOption = new Option(wire.name, wire.id);
        lowerWireSelect.add(lowerOption);
    });
}

async function handleAddVisit(event) {
    event.preventDefault();

    const formData = new FormData(document.getElementById("visitForm"));
    const visitData = {
        PID: PID,
        visitDate: formData.get("visitDate"),
        upperWireID: formData.get("upperWire") || null,
        lowerWireID: formData.get("lowerWire") || null,
        others: formData.get("others"),
        next: formData.get("next")
    };

    const addVisitUrl = `${window.location.origin}/api/addVisit`;
    try {
        const response = await fetch(addVisitUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(visitData)
        });
        const data = await response.json();

        if (data.status === 'success') {
            alert("Visit added successfully!");

            closeModal();
            fetchAndDisplayVisitsSummary();
        } else {
            alert(data.message || "Error adding visit.");

        }
    } catch (error) {
        console.error("Error adding visit:", error);
        alert("Error adding visit.");

    }
}

async function handleUpdateVisit(event) {
    event.preventDefault();

    const formData = new FormData(document.getElementById("visitForm"));
    const visitData = {
        VID: formData.get("VID"),

        visitDate: formData.get("visitDate"),
        upperWireID: formData.get("upperWire") || null,
        lowerWireID: formData.get("lowerWire") || null,
        others: formData.get("others"),
        next: formData.get("next")
    };
    console.log(visitData);
    const editVisitUrl = `${window.location.origin}/api/updateVisit`;
    try {
        const response = await fetch(editVisitUrl, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(visitData)
        });
        const data = await response.json();

        if (data.status === 'success') {
            alert("Visit updated successfully!");

            closeModal();
            fetchAndDisplayVisitsSummary();
        } else {
            alert("Error updating visit.");

        }
    } catch (error) {
        console.error("Error updating visit:", error);
        alert("Error updating visit.");


    }
}
fetchAndDisplayVisitsSummary();