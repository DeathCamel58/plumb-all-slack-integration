require('dotenv').config({ path: process.env.ENV_LOCATION || '/root/plumb-all-slack-integration/.env' });
const fetch = require("node-fetch");

const trelloHost = 'https://api.trello.com';

/**
 * Sends a raw request to Trello's API
 * @param url The endpoint url. E.g. `contact/`
 * @param httpMethod The HTTP method type. E.g. `post`
 * @param data The data to send to the endpoint
 * @returns {Promise<void>}
 */
async function useTrelloAPI(url, httpMethod, data) {
    let query = JSON.stringify(data);
    let response = [];
    try {
        let options = {
            method: httpMethod,
            headers: {
                'Content-Type': 'application/json'
            }
        }
        if (data !== null && data !== undefined) {
            options.body = query;
        }
        response = await fetch(`${trelloHost}/${url}`, options)
        switch (response.status) {
            // HTTP: OK
            case 200:
                // Return the data
                return await response.text();
            // HTTP Bad Request
            case 400:
            default:
                console.log(`Received status ${response.status} from Trello. Body follows.`);
                let text = await response.text();
                console.log(text);
        }
    } catch (e) {
        console.log(`Failed to run a Trello API request.`);
        console.log(e);
    }
}

/**
 * Finds the board ID for given board name
 * @param boardName The board name to search for
 * @returns {Promise<*|null>} The board id, or null
 */
async function getTrelloBoard(boardName) {
    let boardsResponse = await useTrelloAPI(`1/members/me/boards?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`, 'get', null);
    boardsResponse = JSON.parse(boardsResponse);

    for (let i = 0; i < boardsResponse.length; i++) {
        if (boardsResponse[i].name === boardName) {
            return boardsResponse[i].id;
        }
    }

    // If board wasn't found, return null
    return null;
}

/**
 * Finds the list ID for given list name
 * @param boardId The board ID to search for the list in
 * @param listName The list name to search for
 * @returns {Promise<*|null>} The list id, or null
 */
async function getTrelloList(boardId, listName) {
    let listResponse = await useTrelloAPI(`1/boards/${boardId}/lists?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`, 'get', null);
    listResponse = JSON.parse(listResponse);

    for (let i = 0; i < listResponse.length; i++) {
        if (listResponse[i].name === listName) {
            return listResponse[i].id;
        }
    }

    // If board wasn't found, return null
    return null;
}

/**
 * Adds a card to trello with the provided information
 * @param listId The list ID to add the card to
 * @param name The name of the card
 * @param description The description of the card
 * @param address The address of the card
 * @returns {Promise<void>}
 */
async function addTrelloCard(listId, name, description, address) {
    let data = {
        idList: listId,
        key: process.env.TRELLO_API_KEY,
        token: process.env.TRELLO_TOKEN,
        pos: 'top'
    };
    // URL encode the data, and add it to the request
    if (name !== null && name !== undefined) {
        data.name = name;
    }
    if (description !== null && description !== undefined) {
        data.desc = description;
    }
    if (address !== null && address !== undefined) {
        data.address = address;
    }

    // Send the request to Trello
    let response = await useTrelloAPI('1/cards/', 'post', data);
}

/**
 * Adds a contact card to Trello
 * @param contact The contact to add
 * @returns {Promise<void>}
 */
async function addContact(contact) {
    let boardId = await getTrelloBoard(process.env.TRELLO_BOARD_NAME);
    let listId = await getTrelloList(boardId, process.env.TRELLO_LIST_NAME)
    await addTrelloCard(listId, contact.name, contact.message, contact.address)
}

module.exports = {
    addContact
};
