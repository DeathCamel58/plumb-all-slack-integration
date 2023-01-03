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
async function useAPI(url, httpMethod, data) {
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
async function getBoard(boardName) {
    let boardsResponse = await useAPI(`1/members/me/boards?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`, 'get', null);
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
async function getList(boardId, listName) {
    let listResponse = await useAPI(`1/boards/${boardId}/lists?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`, 'get', null);
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
 * Searches Trello for a card in a given list
 * @param query The query to run
 * @param listId The ListID to search for the card in
 * @returns {Promise<*|null>}
 */
async function runSearch(query, listId) {
    let searchQuery = encodeURIComponent(query);
    let searchResponse = await useAPI(`1/search?query=${searchQuery}&key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`, 'get', null);
    searchResponse = JSON.parse(searchResponse);

    if (searchResponse.cards.length > 0) {
        if (listId !== null && listId !== undefined) {
            for (let i = 0; i < searchResponse.cards.length; i++) {
                let card = searchResponse.cards[i];
                let listResponse = await useAPI(`1/cards/${card.id}/list?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}`, 'get', null);
                listResponse = JSON.parse(listResponse);
                if (card.idList === listId) {
                    return card;
                }
            }
        } else {
            return searchResponse.cards[0];
        }
    } else {
        return null;
    }
}

/**
 * Adds a card to trello with the provided information
 * @param listId The list ID to add the card to
 * @param name The name of the card
 * @param description The description of the card
 * @param address The address of the card
 * @returns {Promise<void>}
 */
async function addCard(listId, name, description, address) {
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
    let response = await useAPI('1/cards/', 'post', data);
}

/**
 * Moves a card to a list
 * @param cardId The ID of the card to move
 * @param listId The ID of the destination list
 * @returns {Promise<void>}
 */
async function moveCard(cardId, listId) {
    let moveResponse = await useAPI(`1/cards/${cardId}?key=${process.env.TRELLO_API_KEY}&token=${process.env.TRELLO_TOKEN}&idList=${listId}`, 'put', null);
    moveResponse = JSON.parse(moveResponse);
}

/**
 * Adds a contact card to Trello
 * @param contact The contact to add
 * @returns {Promise<void>}
 */
async function addContact(contact) {
    let boardId = await getBoard(process.env.TRELLO_BOARD_NAME);
    let listId = await getList(boardId, process.env.TRELLO_LIST_NAME_TODO);
    await addCard(listId, contact.name, contact.messageToSend(), contact.address);
}

/**
 * Moves a contact card to a different list
 * @param message The card description to search for
 * @param destinationList The name of the list to move the card to
 * @returns {Promise<void>}
 */
async function moveContactCard(message, destinationList) {
    // Get the board ID
    let boardId = await getBoard(process.env.TRELLO_BOARD_NAME);
    let sourceListId;
    let destinationListId;
    if (destinationList === process.env.TRELLO_LIST_NAME_WIP) {
        sourceListId = await getList(boardId, process.env.TRELLO_LIST_NAME_TODO);
        destinationListId = await getList(boardId, process.env.TRELLO_LIST_NAME_WIP);
    } else if (destinationList === process.env.TRELLO_LIST_NAME_DONE) {
        sourceListId = await getList(boardId, process.env.TRELLO_LIST_NAME_WIP);
        destinationListId = await getList(boardId, process.env.TRELLO_LIST_NAME_DONE);
    } else if (destinationList === process.env.TRELLO_LIST_NAME_NO_GO) {
        sourceListId = await getList(boardId, process.env.TRELLO_LIST_NAME_TODO);
        destinationListId = await getList(boardId, process.env.TRELLO_LIST_NAME_NO_GO);
    }

    let caller = message.split('Caller: ')[1].split('\nAddress: ')[0];
    if (caller.includes('(')) {
        caller = caller.split('(')[0];
    }
    let card = await runSearch(caller, sourceListId);

    // If no card was found, don't move it
    if (card === undefined) {
        return;
    }
    // Move the card to the destination list
    console.log(`Moving Trello Card for ${caller} to ${destinationList}`);
    await moveCard(card.id, destinationListId);
}

module.exports = {
    addContact,
    moveContactCard
};
