/**
 * Update the graph to display given data
 * @param contacts The data to display
 */
function updateGraph(contacts) {
    // console.log('updateGraph called!')

    let startEndDates = [0, 0]
    let listOfTypes = []
    let countedDaysOfType = {}
    for (let i = 0; i < contacts.length; i++) {
        let currentContact = contacts[i];

        if (!(listOfTypes.includes(currentContact.type))) {
            listOfTypes.push(currentContact.type);
        }

        let rawDateOfContact = new Date(currentContact.timestamp);
        let dateOfContact = rawDateOfContact.toDateString();
        if (rawDateOfContact < startEndDates[0] || startEndDates[0] === 0) {
            startEndDates[0] = rawDateOfContact;
        }
        if (rawDateOfContact > startEndDates[1] || startEndDates[1] === 0) {
            startEndDates[1] = rawDateOfContact;
        }
    }


    let daysToShow = [];
    let endDate = new Date(startEndDates[1]);
    endDate.setHours(0, 0, 0, 0);
    endDate.setDate(endDate.getDate() + 1);
    for (let d = new Date(startEndDates[0]); d <= endDate; d.setDate(d.getDate()+1)) {
        daysToShow.push(d.toDateString());

        // Create date for each type
        // console.log(countedDaysOfType)
        for (let i = 0; i < listOfTypes.length; i++) {
            if (listOfTypes[i] in countedDaysOfType) {
                countedDaysOfType[listOfTypes[i]].push({date: d.toDateString(), count: 0});
            } else {
                countedDaysOfType[listOfTypes[i]] = [{date: d.toDateString(), count: 0}]
            }
        }
    }

    for (let i = 0; i < contacts.length; i++) {
        let currentContact = contacts[i];

        let dateOfContact = new Date(currentContact.timestamp).toDateString();
        for (let n = 0; n < countedDaysOfType[currentContact.type].length; n++) {
            if (countedDaysOfType[currentContact.type][n].date === dateOfContact) {
                countedDaysOfType[currentContact.type][n].count += 1;
            }
        }
    }

    feather.replace({ 'aria-hidden': 'true' })

    // Graphs
    const ctx = document.getElementById('myChart')
    // eslint-disable-next-line no-unused-vars

    const DATA_COUNT = 7;
    const NUMBER_CFG = {count: DATA_COUNT, min: -100, max: 100};

    const data = {
        labels: daysToShow,
        datasets: []
    };

    for (let i = 0; i < listOfTypes.length; i++) {
        data.datasets.push(
            {
                label: listOfTypes[i],
                data: countedDaysOfType[listOfTypes[i]].map(e => e.count),
                // borderColor: Utils.CHART_COLORS.red,
                // backgroundColor: Utils.CHART_COLORS.red,
                // fill: true
            }
        )
    }

    if (Chart.getChart('myChart') !== undefined) {
        let oldChart = Chart.getChart('myChart');
        oldChart.destroy();
    }


    // console.log(data)
    const myChart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: (ctx) => 'Chart.js Line Chart - stacked=' + ctx.chart.options.scales.y.stacked
                },
                tooltip: {
                    mode: 'index'
                },
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Month'
                    }
                },
                y: {
                    stacked: true,
                    title: {
                        display: true,
                        text: 'Value'
                    }
                }
            }
        }
    })
}

/**
 * Update the table to display given data
 * @param contacts The data to display
 */
function updateTable(contacts) {
    $('#ContactTableBody tr').remove();
    for (let i = 0; i < contacts.length; i++) {
        let item = contacts[i];
        // create a new row for the table
        let row = $('<tr>');
        // insert the data into the row
        row.append($(`<td><a href="/contact/${item.id}">${item.id}</a></td>`));
        row.append($('<td>').text(item.timestamp));
        row.append($('<td>').text(item.type));
        row.append($('<td>').text(item.name));
        row.append($('<td>').text(item.phone));
        if (item.phone === item.alternatePhone) {
            row.append($('<td>'));
        } else {
            row.append($('<td>').text(item.alternatePhone));
        }
        row.append($('<td>').text(item.email));
        row.append($('<td>').text(item.address));
        // add the row to the table
        $('#ContactTableBody').append(row);
    }
}

// Use AJAX to get the data for the selected date range
$('#dateSelector input[type=radio]').change(function() {
    let selectedDate = $(this).attr("id");
    $.ajax({
        url: `/contacts/${selectedDate}`,
        success: function(response) {
            updateTable(response);
            updateGraph(response);
        }
    });
});

// Use AJAX to get the data for the default date range
$( document ).ready(function() {
    let selectedDate = $('#dateSelector input[checked]').attr("id");
    $.ajax({
        url: `/contacts/${selectedDate}`,
        success: function(response) {
            updateTable(response);
            updateGraph(response);
        }
    });
});
