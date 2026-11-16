import { CATEGORY } from '../core/constants.js';

const samplesByCategory = Object.freeze({
    [CATEGORY.electronics]: [
        ['How is the battery holding up?', 'It shows 91% health in settings; I have not had it independently checked.'],
        ['What is included with it?', 'The original box, cable and clear case are included.'],
        ['Are there any screen marks or frame wear?', 'The screen is clean. There is a small mark near one frame corner.'],
        ['Is the activation lock removed?', 'Yes, it has been signed out and reset.'],
        ['Is proof of purchase available?', 'I can show the receipt during an in-person viewing; no copy is attached here.'],
        ['Can you confirm the model and storage?', 'It is the 256 GB model shown in the listing; I will not post a full serial number.']
    ],
    [CATEGORY.furniture]: [
        ['Could you share the dimensions?', 'It is about 180 cm wide, 85 cm deep and 78 cm high.'],
        ['Is there visible wear?', 'There are a few light marks on the lower frame, shown in the photos.'],
        ['Does it need to be disassembled for collection?', 'The legs can be removed with a basic hex key.']
    ],
    [CATEGORY.homeAppliances]: [
        ['Does it work as expected?', 'It powered on and completed a short test cycle this week.'],
        ['What accessories are included?', 'The removable tray and power cable are included; the manual is not.'],
        ['Has it had any servicing?', 'No service records. It has been used at home for around three years.'],
        ['What is its capacity and power rating?', 'It is a 1.5 litre model; I have not checked the exact wattage.']
    ],
    [CATEGORY.fashion]: [
        ['Could you share a few measurements?', 'Pit-to-pit is 54 cm and the back length is 68 cm, measured flat.'],
        ['How much wear does it have?', 'Some fading at the cuffs; I have not noticed holes or loose seams.'],
        ['Is the original packaging included?', 'No packaging, and I do not have the purchase receipt.']
    ],
    [CATEGORY.booksCollectibles]: [
        ['Which edition is this?', 'It is the 2018 hardback edition; I cannot confirm the exact printing.'],
        ['Are all volumes and inserts present?', 'All listed volumes are present. The paper slipcase has a small tear.'],
        ['Are there markings inside?', 'A previous owner wrote a name on the first page.']
    ]
});

export function getSampleListingQuestions(listings) {
    const records = [];
    Object.entries(samplesByCategory).forEach(([category, questions]) => {
        const categoryListings = listings.filter(listing => listing.category === category);
        const selectedListings = categoryListings.slice(0, category === CATEGORY.electronics ? 3 : 2);
        selectedListings.forEach((listing, listingIndex) => {
            const questionIndexes = category === CATEGORY.electronics
                ? [[0, 1, 2], [3, 4], [5]][listingIndex]
                : category === CATEGORY.homeAppliances
                    ? listingIndex === 0 ? [0, 1, 2, 3] : [2]
                    : listingIndex === 0 ? [0, 1, 2] : [2];
            questionIndexes.forEach(questionIndex => {
                const [question, answer] = questions[questionIndex];
                records.push({
                    id: `sample-question-${listing.id}-${questionIndex + 1}`,
                    listingId: listing.id,
                    questioningDemoUserId: listing.sellerUserId === 'demo-user-kunal' ? 'demo-user-mira' : 'demo-user-kunal',
                    question,
                    createdAt: new Date(Date.parse(listing.listedAt) - (questionIndex + 1) * 86400000).toISOString(),
                    answer,
                    answeredAt: new Date(Date.parse(listing.listedAt) - questionIndex * 43200000).toISOString(),
                    answeringSellerId: listing.sellerUserId,
                    publicStatus: 'public',
                    prototypeSample: true
                });
            });
        });
    });
    return records;
}