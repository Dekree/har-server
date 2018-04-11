module.exports = {
    // will add port to requested url if it with port in har file
    // it because of hosts file in windows can't work with ports
    serverUrl: 'doctor.solit-clouds.ru',

    // defaults to 80
    serverPort: '8017',

    // server protocol
    // defaults to http:
    serverProtocol: '',

    // specify some url to serve from har file
    // if array is empty will serve all from server
    // for serving all from har file add one item 'all'
    filterPaths: [
        // 'all'
        // '/adapter/context/userContext.api'
    ]
};