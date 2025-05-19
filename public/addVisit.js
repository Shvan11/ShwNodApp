document.addEventListener('DOMContentLoaded', (event) => {
    const urlParams = new URLSearchParams(window.location.search);
    const pid = urlParams.get('PID');
    document.getElementById('PID').value = pid;
    document.getElementById('visitDate').value = new Date().toISOString().substring(0, 10);
    fetch('api/getWires')
        .then(response => response.json())
        .then(data => {
            const upperWireSelect = document.getElementById('upperWire');
            const lowerWireSelect = document.getElementById('lowerWire');

            data.forEach(wire => {
                const upperOption = document.createElement('option');
                upperOption.value = wire.id;
                upperOption.text = wire.name;
                upperWireSelect.add(upperOption);

                const lowerOption = document.createElement('option');
                lowerOption.value = wire.id;
                lowerOption.text = wire.name;
                lowerWireSelect.add(lowerOption);
            });
        });
});