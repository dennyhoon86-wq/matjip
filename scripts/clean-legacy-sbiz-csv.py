"""Keep the address/point columns from older public business CSVs.

Some older releases contain stray quotes in unrelated fields. Python's CSV
reader tolerates those rows; rows without the expected columns are skipped.
"""
import csv
import sys


def main(source, output):
    scanned = skipped = written = 0
    with open(source, newline='', encoding='utf-8-sig', errors='replace') as inp, open(
        output, 'w', newline='', encoding='utf-8'
    ) as out:
        reader = csv.reader(inp, strict=False)
        header = next(reader)
        columns = [header.index(name) for name in ('지번주소', '상호명', '경도', '위도')]
        writer = csv.writer(out)
        writer.writerow(('지번주소', '상호명', '경도', '위도'))
        for row in reader:
            scanned += 1
            if len(row) <= max(columns):
                skipped += 1
                continue
            writer.writerow([row[index] for index in columns])
            written += 1
    print(f'scanned={scanned} written={written} skipped={skipped}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
