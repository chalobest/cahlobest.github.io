mapboxgl.accessToken = 'pk.eyJ1IjoicGxhbmVtYWQiLCJhIjoiY2xnMG11YjdjMTBseTNzcXJ6bGp4b3BvZSJ9.vUb221BNvz-mtF3rNAEMhw';

let appData = {
    stopDirections: {},
    userLocation: {},
    nearestStops: []
}

// Set bounds to Mumbai.
const bounds = [[72.39674, 18.82311], [73.41535, 19.44571]]

const map = new mapboxgl.Map({
    container: 'map', // container ID
    // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
    style: 'mapbox://styles/planemad/clh0ypb5o00e701qt5nw9f67y', // style URL
    center: [72.86, 19.1], // starting position [lng, lat]
    zoom: 10, // starting zoom
    hash: true,
    maxBounds: bounds // Set the map's geographical boundaries.

});

// Add geolocate control to the map.
const geolocate =
    new mapboxgl.GeolocateControl({
        positionOptions: {
            enableHighAccuracy: true
        },
        // When active the map will receive updates to the device's location as it changes.
        trackUserLocation: true,
        // Draw an arrow next to the location dot to indicate which direction the device is heading.
        showUserHeading: true
    })
// Add the control to the map.
map.addControl(geolocate);

map.on('load', () => {

    // Trigger geolocate if no url hash location
    if (window.location.href.indexOf('#') === -1) {
        geolocate.trigger();
    }

    if (map.getZoom() > 14) {
        showBusStopsAtPoint()
    }

    setupMap()

    function setupMap() {

        map.addSource('walking-route', {
            'type': 'geojson',
            'data': null
        })

        map.addLayer({
            'id': 'walking-route',
            'type': 'line',
            'source': 'walking-route',
            'layout': {},
            'paint': {
                'line-color': 'black',
                'line-opacity': 1,
                'line-width': 2
            }
        });
    }

});

// Find nearest stops after the map is moved and zoomed in
map.on('moveend', () => {
    if (map.getZoom() > 14) {
        showBusStopsAtPoint()
        showBusRoutesAtPoint(map.getCenter(), 30)
    }
})

map.on('click', (e) => {

    showBusRoutesAtPoint(e.point, 30)
    showBusStopsAtPoint(e.lngLat)

});

function showBusRoutesAtPoint(point, bufferPixels) {

    // Set `bbox` as 5px reactangle area around clicked point.
    const bbox = [
        [point.x - bufferPixels, point.y - bufferPixels],
        [point.x + bufferPixels, point.y + bufferPixels]
    ];
    // Find features intersecting the bounding box.
    const selectedFeatures = map.queryRenderedFeatures(bbox, {
        layers: ['mumbai-bus-routes']
    });

    const route_ids = selectedFeatures.map(
        (feature) => feature.properties.id
    );

    filterBusRoutes(route_ids)
}

function filterBusRoutes(route_ids) {
    // Set a filter matching selected features by FIPS codes
    // to activate the 'counties-highlighted' layer.
    map.setFilter('mumbai-bus-routes', route_ids.length ? ['in', 'id', ...route_ids] : null)
    map.setFilter('mumbai-bus-routes label', route_ids.length ? ['in', 'id', ...route_ids] : null)
    map.setFilter('mumbai-bus-routes selected', route_ids.length ? ['in', 'id', ...route_ids] : null)
    map.setFilter('mumbai-bus-routes label', route_ids.length ? ['in', 'id', ...route_ids] : ['in', 'id', null])
}


function showBusStopsAtPoint(point) {

    if (typeof point == 'undefined') {
        point = map.getCenter();
    }

    // Query the 'bus-stop' layer for rendered features
    let features = map.queryRenderedFeatures({ layers: ['mumbai-bus-stops terminal label','mumbai-bus-stops label'] });

    // Create a list of the nearest bus stops
    features.forEach(f => f.properties["distance"] = turf.distance([point.lng, point.lat], f.geometry.coordinates))
    appData["nearestStops"] = features.sort((a, b) => a.properties.distance - b.properties.distance).slice(0, 10)

    filterBusStops([appData["nearestStops"][0].properties.id])

    showWalkingRoute(new mapboxgl.LngLat(appData["nearestStops"][0].geometry.coordinates[0], appData["nearestStops"][0].geometry.coordinates[1]))

    findStopEta(appData["nearestStops"][0])

}


function filterBusStops(stop_ids) {
    map.setFilter('mumbai-bus-stops stop selected', stop_ids.length ? ['in', 'id', ...stop_ids] : null)
}

function showWalkingRoute(to) {

    const from = map.getCenter()

    // https://docs.mapbox.com/playground/directions/
    const mapboxDirectionsUrl = `https://api.mapbox.com/directions/v5/mapbox/walking/${from.lng},${from.lat};${to.lng},${to.lat}?alternatives=true&continue_straight=true&geometries=geojson&language=en&overview=simplified&steps=true&access_token=${mapboxgl.accessToken}`

    fetch(mapboxDirectionsUrl).then((response) => response.json())
        .then((data) => {
            appData.stopDirections = data

            setTimeout(updateWalkingTime, 500)
            function updateWalkingTime() {
                document.getElementById('walking-time').innerHTML = appData.stopDirections.routes.length ? parseInt(appData.stopDirections.routes[0].duration / 60) + 1 + ' mins walk' : ''
            }
            map.getSource('walking-route').setData(turf.lineString(data.routes[0].geometry.coordinates))
        })
}

function findStopEta(stopFeature) {

    const stopEtaDiv = document.getElementById("stop-eta");

    fetch(`https://chalo.com/app/api/vasudha/stop/mumbai/${stopFeature.properties.id}`)
        .then((response) => response.json())
        .then((data) => {

            // Find all routes in map view
            // Find features intersecting the bounding box.
            const busRoutes = map.queryRenderedFeatures({
                layers: ['mumbai-bus-routes']
            });

            let stopTimetable = []

            // Loop through each key in the object
            for (const routeId in data) {

                // SKip empty objects
                if (!Object.keys(data[routeId]).length)
                    continue

                // Find the route details from the map
                const routeDetail = busRoutes.filter(d => d.properties.id == routeId)[0]

                if (typeof routeDetail == 'undefined') {
                    console.log('Cannot find detail of route ', routeId, data[routeId])
                    continue
                }

                let routeObj = routeDetail.properties

                routeObj["etas"] = []

                for (const tripId in data[routeId]) {

                    const val = JSON.parse(data[routeId][tripId])

                    // Skip stale ETA if timestamps are more than 60 mins old
                    if (new Date().getTime() - val.tS > 60 * 60 * 1000)
                        continue

                    // Skip invalid ETA
                    if (val.eta == -1)
                        continue

                    const etaObj = {
                        route_name: val.rN,
                        vehicle_no: val.vNo,
                        destination: val.dest,
                        eta_mins: val.eta,
                        ts: val.tS,
                        updated_mins: Math.floor((new Date().getTime() - val.tS) / 60000)
                    };

                    routeObj["etas"].push(etaObj)


                }

                stopTimetable.push(routeObj)
            }

            console.log(stopTimetable.filter(d => d.etas.length).sort((a, b) => b.trip_count - a.trip_count))

            let etaHtml = `<h2 class="stop uk-margin-remove">${stopFeature.properties.name} <br><small><span id='walking-time'></span></small></h2><br>
            Towards <b>${stopFeature.properties.towards_stop}</b> <hr>`
            console.log(appData.stopDirections)
            const sortedTimetable = stopTimetable.filter(d => d.etas.length).sort((a, b) => b.trip_count - a.trip_count)

            sortedTimetable.forEach(route => {
                etaHtml += `<div class="eta">
                <a class="route uk-button uk-button-default" target="_blank" href="https://chalo.com/app/live-tracking/route-map/${route.id}"><b>${route.name}</b></a> 
                <span uk-tooltip="${route.stop_name_list}">${route.last_stop_name}</span>
                </div><div><a href="https://chalo.com/app/live-tracking/time-table/${route.id}">Timetable</a>`

                route.etas.sort(function (a, b) { return a.eta_mins - b.eta_mins }).forEach(eta => {
                    etaHtml += `<span class="uk-float-right" uk-tooltip="Vehicle no. ${eta.vehicle_no} updated ${eta.updated_mins < 1 ? "now" : eta.updated_mins + " mins ago"}.">
                <b>${Math.floor(eta.eta_mins / 60)}m</b>${eta.updated_mins > 3 ? '<img width=15 src="./assets/yellow-pulsing-dot.gif">' : '<img width=15 src="./assets/green-pulsing-dot.gif">'}
                </span>`

                })

                etaHtml += `</div><hr>`

            })

            etaHtml += `<h5>Terminating routes</h5>${stopFeature.properties.terminal_route_name_list}`
            etaHtml += `<h5>All routes</h5>${stopFeature.properties.route_name_list}`
            stopEtaDiv.innerHTML = etaHtml

            console.log(stopFeature.properties)

        })
        .catch((error) => {
            console.error(error);
            stopEtaDiv.innerHTML = "<p>Error fetching stop ETA data.</p>";
        });

}