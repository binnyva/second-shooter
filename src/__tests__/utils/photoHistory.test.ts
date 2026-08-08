import { appendPhoto, HistoryPhoto } from '../../utils/photoHistory';

function photo(timestamp: number): HistoryPhoto {
  return { uri: `file:///cache/photo-${timestamp}.jpg`, timestamp };
}

describe('appendPhoto', () => {
  it('appends to an empty history', () => {
    const { list, evicted } = appendPhoto([], photo(100), 20);

    expect(list).toEqual([photo(100)]);
    expect(evicted).toEqual([]);
  });

  it('keeps the history oldest first', () => {
    let list: HistoryPhoto[] = [];
    for (const ts of [100, 200, 300]) {
      list = appendPhoto(list, photo(ts), 20).list;
    }

    expect(list.map((p) => p.timestamp)).toEqual([100, 200, 300]);
  });

  it('sorts a photo that arrives out of order', () => {
    const list = [photo(100), photo(300)];

    const result = appendPhoto(list, photo(200), 20);

    expect(result.list.map((p) => p.timestamp)).toEqual([100, 200, 300]);
    expect(result.evicted).toEqual([]);
  });

  it('evicts the oldest entry once the cap is reached', () => {
    const list = [photo(100), photo(200), photo(300)];

    const result = appendPhoto(list, photo(400), 3);

    expect(result.list.map((p) => p.timestamp)).toEqual([200, 300, 400]);
    expect(result.evicted).toEqual([photo(100)]);
  });

  it('evicts every overflowing entry when the history starts over the cap', () => {
    const list = [photo(100), photo(200), photo(300), photo(400)];

    const result = appendPhoto(list, photo(500), 2);

    expect(result.list.map((p) => p.timestamp)).toEqual([400, 500]);
    expect(result.evicted.map((p) => p.timestamp)).toEqual([100, 200, 300]);
  });

  it('evicts the new photo too when the cap is zero', () => {
    const result = appendPhoto([photo(100)], photo(200), 0);

    expect(result.list).toEqual([]);
    expect(result.evicted.map((p) => p.timestamp)).toEqual([100, 200]);
  });

  it('does not mutate the history it is given', () => {
    const list = [photo(100), photo(200)];

    appendPhoto(list, photo(300), 2);

    expect(list.map((p) => p.timestamp)).toEqual([100, 200]);
  });
});
