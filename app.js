mapboxgl.accessToken = 'pk.eyJ1IjoicGxhbmVtYWQiLCJhIjoiY2xnMG11YjdjMTBseTNzcXJ6bGp4b3BvZSJ9.vUb221BNvz-mtF3rNAEMhw';

// Set bounds to Mumbai.
const bounds = [[72.39674, 18.82311], [73.41535, 19.44571]]

const map = new mapboxgl.Map({
    container: 'map', // container ID
    // Choose from Mapbox's core styles, or make your own style with Mapbox Studio
    style: 'mapbox://styles/planemad/clfuxjmx7002k01nxn4o2cbla', // style URL
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

});

// Find nearest stops after the map is moved and zoomed in
map.on('moveend', () => {
    if (map.getZoom() > 14) {
        showBusStopsAtPoint()
    }
})

map.on('click', (e) => {

    showBusRoutesAtPoint(e.point, 5)
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
        layers: ['bus-routes']
    });

    const route_ids = selectedFeatures.map(
        (feature) => feature.properties.id
    );

    filterBusRoutes(route_ids)
}

function filterBusRoutes(route_ids) {
    // Set a filter matching selected features by FIPS codes
    // to activate the 'counties-highlighted' layer.
    map.setFilter('bus-routes', route_ids.length ? ['in', 'id', ...route_ids] : null)
    map.setFilter('bus-routes label', route_ids.length ? ['in', 'id', ...route_ids] : null)
    map.setFilter('bus-routes selected', route_ids.length ? ['in', 'id', ...route_ids] : null)
    map.setFilter('bus-routes selected label heading', route_ids.length ? ['in', 'id', ...route_ids] : ['in', 'id', null])
    map.setFilter('bus-routes selected label info', route_ids.length ? ['in', 'id', ...route_ids] : ['in', 'id', null])
}

function filterBusStops(stop_ids) {
    map.setFilter('bus-stops selected', stop_ids.length ? ['in', 'id', ...stop_ids] : null)
}

function showBusStopsAtPoint(point) {

    if (typeof point == 'undefined') {
        point = map.getCenter();
    }

    // Query the 'bus-stop' layer for rendered features
    const features = map.queryRenderedFeatures({ layers: ['bus-stops'] });

    // Find the nearest bus stop point feature to the current center
    const nearest = turf.nearestPoint([point.lng, point.lat], turf.featureCollection(features));

    // Get the coordinates of the nearest bus stop point feature
    const nearestCoords = nearest.geometry.coordinates;

    filterBusStops([nearest.properties.id])

    findStopEta(nearest)
}

function findStopEta(stopFeature) {

    const stopEtaDiv = document.getElementById("stop-eta");

    fetch(`https://chalo.com/app/api/vasudha/stop/mumbai/${stopFeature.properties.id}`)
        .then((response) => response.json())
        .then((data) => {

            // Find all routes in map view
            // Find features intersecting the bounding box.
            const busRoutes = map.queryRenderedFeatures({
                layers: ['bus-routes']
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
                    if ( new Date().getTime() - val.tS > 60 * 60 * 1000 )
                        continue

                    // Skip invalid ETA
                    if ( val.eta == -1 )
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

            console.log(stopTimetable.filter(d=>d.etas.length).sort((a, b) => b.trip_count - a.trip_count))

            let etaHtml = `<h2 class="stop uk-heading">${stopFeature.properties.name}</h2><hr>`

            const sortedTimetable = stopTimetable.filter(d=>d.etas.length).sort((a, b) => b.trip_count - a.trip_count)

            sortedTimetable.forEach( route => {
                etaHtml += `<div>
                <a class="route uk-button uk-button-default" href=""><b>${route.name}</b></a> To: <b>${route.last_stop_name}</b> From : ${route.first_stop_name} 
                </div>`

                route.etas.forEach( eta => {
                    etaHtml += `<div>
                <b>${Math.floor(eta.eta_mins / 60)}m</b> updated ${eta.updated_mins}m ago
                </div>`

                })

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